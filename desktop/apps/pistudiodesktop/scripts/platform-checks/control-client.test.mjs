import { createServer } from "node:net";

import { afterEach, describe, expect, it } from "vitest";

import { ControlClient, parseConfigDir, parseControlPort } from "./control-client.mjs";

describe("log parsing", () => {
  it("reads the control port and the configuration directory", () => {
    const log = [
      "pistudiodesktop: control server listening on 127.0.0.1:50123",
      "INFO  pistudiodesktop_shell: configuration directory: /Users/r/Library/Application Support/com.avatsaev.pi-studio",
    ].join("\n");
    expect(parseControlPort(log)).toBe(50123);
    expect(parseConfigDir(log)).toBe("/Users/r/Library/Application Support/com.avatsaev.pi-studio");
  });

  it("answers null while the app has not said", () => {
    expect(parseControlPort("starting")).toBeNull();
    expect(parseConfigDir("starting")).toBeNull();
  });
});

describe("ControlClient", () => {
  const servers = [];
  afterEach(() => servers.splice(0).forEach((server) => server.close()));

  /** A fake app: accepts `token`, answers each request with `reply(request)`. */
  async function fakeApp(token, reply) {
    const server = createServer((socket) => {
      let buffer = "";
      let authed = false;
      socket.on("data", (chunk) => {
        buffer += chunk;
        for (let end = buffer.indexOf("\n"); end !== -1; end = buffer.indexOf("\n")) {
          const request = JSON.parse(buffer.slice(0, end));
          buffer = buffer.slice(end + 1);
          if (!authed) {
            authed = request.params.token === token;
            socket.write(`${JSON.stringify(authed ? { id: request.id, ok: true, result: { authenticated: true } } : { id: request.id, ok: false, error: "authentication required" })}\n`);
          } else {
            socket.write(`${JSON.stringify({ id: request.id, ...reply(request) })}\n`);
          }
        }
      });
    });
    servers.push(server);
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    return server.address().port;
  }

  it("authenticates, resolves results and rejects errors, and keeps every reply line", async () => {
    const port = await fakeApp("t0k", (request) =>
      request.method === "boom" ? { ok: false, error: "nope" } : { ok: true, result: { method: request.method, params: request.params } },
    );
    const client = await ControlClient.connect({ port, token: "t0k" });
    await expect(client.execute("settings.get")).resolves.toEqual({ method: "engine.execute", params: { command: "settings.get" } });
    await expect(client.execute("settings.set", { key: "k", value: 1 })).resolves.toMatchObject({ params: { command: "settings.set", params: { key: "k", value: 1 } } });
    await expect(client.call("boom")).rejects.toThrow("boom: nope");
    expect(client.replies).toHaveLength(4);
    expect(client.replies.every((line) => typeof line === "string")).toBe(true);
    client.close();
  });

  it("rejects a wrong token", async () => {
    const port = await fakeApp("right", () => ({ ok: true, result: null }));
    await expect(ControlClient.connect({ port, token: "wrong" })).rejects.toThrow("authentication required");
  });

  it("rejects a call made after the socket closed", async () => {
    const port = await fakeApp("t", () => ({ ok: true, result: null }));
    const client = await ControlClient.connect({ port, token: "t" });
    servers[0].close();
    client.close();
    await expect(client.call("x")).rejects.toThrow("closed");
  });
});
