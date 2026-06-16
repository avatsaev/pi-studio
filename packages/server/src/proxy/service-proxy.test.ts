import { createServer, request as httpRequest, type Server } from "node:http";
import { AddressInfo } from "node:net";

import { afterEach, describe, expect, it } from "vitest";

import { serviceHostname, serviceLabel } from "./service-hostname.js";
import { assignFreePort, ServicePortRegistry } from "./service-port-registry.js";
import { resolveServiceProxyConfig, ServiceProxy } from "./service-proxy.js";

describe("serviceLabel / hostname generation", () => {
  it("builds the combined leftmost label and omits branch for main/master", () => {
    expect(serviceLabel({ script: "dev", branch: "feature/auth", project: "miniweb" })).toBe(
      "dev--feature-auth--miniweb",
    );
    expect(serviceLabel({ script: "dev", branch: "main", project: "miniweb" })).toBe(
      "dev--miniweb",
    );
    expect(serviceLabel({ script: "dev", branch: "master", project: "miniweb" })).toBe(
      "dev--miniweb",
    );
    expect(serviceHostname({ script: "dev", project: "miniweb" })).toBe("dev--miniweb.localhost");
  });

  it("truncates over-63-char labels with a deterministic hash suffix", () => {
    const long = serviceLabel({
      script: "s".repeat(40),
      branch: "b".repeat(40),
      project: "p".repeat(40),
    });
    expect(long.length).toBeLessThanOrEqual(63);
    expect(long).toMatch(/-[0-9a-f]{7}$/);
    // Deterministic.
    const again = serviceLabel({
      script: "s".repeat(40),
      branch: "b".repeat(40),
      project: "p".repeat(40),
    });
    expect(again).toBe(long);
  });
});

describe("ServicePortRegistry", () => {
  it("registers localhost (and public when configured) routes and deregisters on stop", () => {
    const reg = new ServicePortRegistry("https://apps.example.com");
    const route = reg.register({ slot: 1, script: "dev", project: "miniweb", port: 4321 });
    expect(route.hostnames).toContain("dev--miniweb.localhost");
    expect(route.hostnames).toContain("dev--miniweb.apps.example.com");
    expect(reg.lookup("dev--miniweb.localhost")?.port).toBe(4321);
    expect(reg.lookup("dev--miniweb.localhost:80")?.port).toBe(4321); // strips :port
    expect(reg.unregister(1)).toBe(true);
    expect(reg.lookup("dev--miniweb.localhost")).toBeUndefined();
  });

  it("assigns a free local port", async () => {
    const port = await assignFreePort();
    expect(port).toBeGreaterThan(0);
  });
});

describe("resolveServiceProxyConfig", () => {
  it("applies env overrides over config (env wins)", () => {
    const cfg = resolveServiceProxyConfig(
      { listen: "0.0.0.0:8080", publicBaseUrl: "https://a.com", enabled: true },
      { PI_STUDIO_SERVICE_PROXY_LISTEN: "127.0.0.1:9000" } as NodeJS.ProcessEnv,
    );
    expect(cfg.listen).toBe("127.0.0.1:9000");
    expect(cfg.publicBaseUrl).toBe("https://a.com");
    expect(cfg.enabled).toBe(true);
  });

  it("enabled:false suppresses only the optional public/listen layers", () => {
    const proxy = new ServiceProxy({
      enabled: false,
      listen: "0.0.0.0:8080",
      publicBaseUrl: "https://a.com",
    });
    // Listener suppressed.
    expect(proxy.listenAddress).toBeUndefined();
    // Localhost proxy stays on; public alias is NOT registered.
    const route = proxy.registry.register({ slot: 1, script: "dev", project: "p", port: 1 });
    expect(route.hostnames).toEqual(["dev--p.localhost"]);
  });
});

describe("ServiceProxy.handleRequest", () => {
  const servers: Server[] = [];
  afterEach(() => {
    for (const s of servers) s.close();
    servers.length = 0;
  });

  it("reverse-proxies a matching Host to the service port, forwarding Host unchanged", async () => {
    // Start a fake dev service.
    let receivedHost = "";
    const service = createServer((req, res) => {
      receivedHost = req.headers.host ?? "";
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("from service");
    });
    servers.push(service);
    await new Promise<void>((r) => service.listen(0, "127.0.0.1", r));
    const port = (service.address() as AddressInfo).port;

    // Proxy in front, route registered.
    const proxy = new ServiceProxy({ enabled: true });
    proxy.registry.register({ slot: 1, script: "dev", project: "miniweb", port });
    const front = createServer((req, res) => {
      if (!proxy.handleRequest(req, res)) {
        res.writeHead(404);
        res.end("daemon");
      }
    });
    servers.push(front);
    await new Promise<void>((r) => front.listen(0, "127.0.0.1", r));
    const frontPort = (front.address() as AddressInfo).port;

    // `fetch` forbids overriding Host, so use raw http.request with an explicit Host header.
    const get = (host: string): Promise<{ status: number; body: string }> =>
      new Promise((resolve, reject) => {
        const r = httpRequest(
          { host: "127.0.0.1", port: frontPort, path: "/", headers: { host } },
          (resp) => {
            let body = "";
            resp.on("data", (c) => (body += c));
            resp.on("end", () => resolve({ status: resp.statusCode ?? 0, body }));
          },
        );
        r.on("error", reject);
        r.end();
      });

    // Matching Host → proxied.
    const matched = await get("dev--miniweb.localhost");
    expect(matched.body).toBe("from service");
    expect(receivedHost).toBe("dev--miniweb.localhost"); // Host forwarded unchanged

    // Unknown Host → falls through to normal daemon handling.
    const unmatched = await get("unknown.localhost");
    expect(unmatched.status).toBe(404);
    expect(unmatched.body).toBe("daemon");
  });
});
