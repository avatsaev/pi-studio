import { type Server } from "node:http";
import { request } from "node:http";
import { type AddressInfo } from "node:net";

import { afterEach, describe, expect, it } from "vitest";

import { createHostChecker } from "./host-allowlist.js";
import { createHttpServer } from "./http-server.js";

interface Resp {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

function listen(server: Server): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve((server.address() as AddressInfo).port));
  });
}

function call(
  port: number,
  options: { method?: string; path?: string; headers?: Record<string, string> },
): Promise<Resp> {
  return new Promise((resolve, reject) => {
    const req = request(
      {
        host: "127.0.0.1",
        port,
        method: options.method ?? "GET",
        path: options.path ?? "/",
        headers: options.headers,
      },
      (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
      },
    );
    req.on("error", reject);
    req.end();
  });
}

const servers: Server[] = [];
afterEach(() => {
  for (const s of servers) s.close();
  servers.length = 0;
});

async function start(deps: Parameters<typeof createHttpServer>[0]): Promise<number> {
  const server = createHttpServer(deps);
  servers.push(server);
  return listen(server);
}

describe("createHostChecker", () => {
  it("allows localhost, *.localhost, and literal IPs by default", () => {
    const check = createHostChecker([]);
    expect(check("localhost:6767")).toBe(true);
    expect(check("foo.localhost")).toBe(true);
    expect(check("127.0.0.1:6767")).toBe(true);
    expect(check("[::1]:6767")).toBe(true);
    expect(check("evil.example.com")).toBe(false);
  });

  it("extends via entries, with '.'-prefix matching subdomains", () => {
    const check = createHostChecker(["app.example.com", ".trusted.dev"]);
    expect(check("app.example.com")).toBe(true);
    expect(check("other.example.com")).toBe(false);
    expect(check("trusted.dev")).toBe(true);
    expect(check("api.trusted.dev")).toBe(true);
  });

  it("disables validation when set to true", () => {
    expect(createHostChecker(true)("evil.example.com")).toBe(true);
  });
});

describe("HTTP server pipeline", () => {
  it("GET /api/health succeeds without host validation or auth", async () => {
    const port = await start({ hostnames: [], authenticate: () => false });
    const res = await call(port, { path: "/api/health", headers: { Host: "evil.example.com" } });
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ status: "ok" });
  });

  it("rejects a disallowed Host with 403", async () => {
    const port = await start({ hostnames: [] });
    const res = await call(port, { path: "/", headers: { Host: "evil.example.com" } });
    expect(res.status).toBe(403);
    expect(res.body).toBe("Host not allowed");
  });

  it("PI_STUDIO_HOSTNAMES=true (hostnames:true) disables host validation", async () => {
    const port = await start({ hostnames: true });
    const res = await call(port, { path: "/", headers: { Host: "evil.example.com" } });
    expect(res.status).toBe(404); // passes host check, no route → 404
  });

  it("allows OPTIONS preflight with CORS headers", async () => {
    const port = await start({ allowedOrigins: ["https://app.test"], hostnames: [] });
    const res = await call(port, {
      method: "OPTIONS",
      path: "/",
      headers: { Host: "evil.example.com", Origin: "https://app.test" },
    });
    expect(res.status).toBe(204);
    expect(res.headers["access-control-allow-origin"]).toBe("https://app.test");
    expect(res.headers["access-control-allow-methods"]).toContain("OPTIONS");
  });

  it("does not reflect a disallowed CORS origin", async () => {
    const port = await start({ allowedOrigins: ["https://app.test"], hostnames: true });
    const res = await call(port, { path: "/", headers: { Origin: "https://evil.test" } });
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });
});
