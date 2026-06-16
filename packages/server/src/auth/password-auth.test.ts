import { type Server } from "node:http";
import { request } from "node:http";
import { type AddressInfo } from "node:net";

import bcrypt from "bcryptjs";
import { afterEach, describe, expect, it } from "vitest";

import { createHttpServer } from "../http/http-server.js";
import {
  bearerFromSubprotocol,
  createPasswordAuth,
  isBcryptHash,
  resolvePasswordHash,
} from "./password-auth.js";

const PASSWORD = "hunter2";

describe("resolvePasswordHash", () => {
  it("hashes a plaintext secret and accepts an existing hash", () => {
    const fromPlain = resolvePasswordHash({ envPassword: PASSWORD });
    expect(fromPlain).toBeDefined();
    expect(isBcryptHash(fromPlain as string)).toBe(true);

    const existing = bcrypt.hashSync(PASSWORD, 10);
    expect(resolvePasswordHash({ configPassword: existing })).toBe(existing);
  });

  it("returns undefined when no password is configured", () => {
    expect(resolvePasswordHash({})).toBeUndefined();
  });

  it("lets env override config", () => {
    const hash = resolvePasswordHash({ configPassword: "ignored", envPassword: PASSWORD });
    expect(bcrypt.compareSync(PASSWORD, hash as string)).toBe(true);
    expect(bcrypt.compareSync("ignored", hash as string)).toBe(false);
  });
});

describe("createPasswordAuth", () => {
  it("when disabled allows everything", () => {
    const auth = createPasswordAuth(undefined);
    expect(auth.enabled).toBe(false);
    expect(auth.authenticateHttp({ headers: {} })).toBe(true);
    expect(auth.authenticateUpgrade({ headers: {} })).toBe(true);
  });

  it("verifies the WS bearer subprotocol", () => {
    const auth = createPasswordAuth(resolvePasswordHash({ envPassword: PASSWORD }));
    expect(
      auth.authenticateUpgrade({
        headers: { "sec-websocket-protocol": `pi-studio.bearer.${PASSWORD}` },
      }),
    ).toBe(true);
    expect(
      auth.authenticateUpgrade({
        headers: { "sec-websocket-protocol": "pi-studio.bearer.wrong" },
      }),
    ).toBe(false);
    expect(auth.authenticateUpgrade({ headers: {} })).toBe(false);
  });

  it("parses the bearer subprotocol from a multi-value list", () => {
    expect(bearerFromSubprotocol(`json, pi-studio.bearer.${PASSWORD}`)).toBe(PASSWORD);
    expect(bearerFromSubprotocol("json, other")).toBeUndefined();
  });
});

// --- HTTP integration: bearer required, health exempt ---

interface Resp {
  status: number;
  body: string;
}

function listen(server: Server): Promise<number> {
  return new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve((server.address() as AddressInfo).port)),
  );
}

function call(port: number, path: string, headers?: Record<string, string>): Promise<Resp> {
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port, path, headers }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
    });
    req.on("error", reject);
    req.end();
  });
}

const servers: Server[] = [];
afterEach(() => {
  for (const s of servers) s.close();
  servers.length = 0;
});

describe("HTTP bearer enforcement", () => {
  it("rejects without a valid bearer but exempts /api/health", async () => {
    const auth = createPasswordAuth(resolvePasswordHash({ envPassword: PASSWORD }));
    const server = createHttpServer({
      hostnames: true,
      authenticate: (req) => auth.authenticateHttp(req),
    });
    servers.push(server);
    const port = await listen(server);

    expect((await call(port, "/")).status).toBe(401);
    expect((await call(port, "/", { Authorization: `Bearer ${PASSWORD}` })).status).toBe(404);
    expect((await call(port, "/api/health")).status).toBe(200);
  });
});
