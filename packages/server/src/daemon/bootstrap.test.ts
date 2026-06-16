import { once } from "node:events";
import { existsSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";

import { bootstrap, type DaemonHandle } from "./bootstrap.js";
import { silentLogger } from "../logging/logger.js";

const handles: DaemonHandle[] = [];
afterEach(async () => {
  for (const h of handles) await h.close();
  handles.length = 0;
});

async function startDaemon(): Promise<DaemonHandle> {
  const home = await mkdtemp(join(tmpdir(), "pi-studio-boot-"));
  const handle = await bootstrap({
    env: { PI_STUDIO_HOME: home, PI_STUDIO_LISTEN: "127.0.0.1:0" },
    logger: silentLogger(),
  });
  handles.push(handle);
  return handle;
}

function health(port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port, path: "/api/health" }, (res) => {
      res.resume();
      resolve(res.statusCode ?? 0);
    });
    req.on("error", reject);
    req.end();
  });
}

async function handshake(port: number): Promise<WebSocket> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  await once(ws, "open");
  ws.send(JSON.stringify({ type: "hello", clientId: "c1", clientType: "cli", protocolVersion: 1 }));
  await once(ws, "message"); // server_info
  return ws;
}

describe("bootstrap", () => {
  it("listens, serves /api/health, and writes the PID file", async () => {
    const handle = await startDaemon();
    expect(handle.port).toBeGreaterThan(0);
    expect(await health(handle.port)).toBe(200);
    expect(existsSync(join(handle.home, "pi-studio.pid"))).toBe(true);
  });

  it("answers ping with pong echoing requestId", async () => {
    const handle = await startDaemon();
    const ws = await handshake(handle.port);
    ws.send(JSON.stringify({ type: "ping", requestId: "ping-9", clientSentAt: 1 }));
    const [data] = (await once(ws, "message")) as [Buffer];
    const pong = JSON.parse(data.toString());
    expect(pong.type).toBe("pong");
    expect(pong.requestId).toBe("ping-9");
    ws.close();
  });

  it("a throwing handler yields rpc_error and keeps the socket open", async () => {
    const handle = await startDaemon();
    handle.registry.register("explode.request", () => {
      throw new Error("nope");
    });
    const ws = await handshake(handle.port);
    ws.send(
      JSON.stringify({ type: "session", message: { type: "explode.request", requestId: "x1" } }),
    );
    const [data] = (await once(ws, "message")) as [Buffer];
    const env = JSON.parse(data.toString());
    expect(env.message.type).toBe("rpc_error");
    expect(env.message.requestId).toBe("x1");
    expect(ws.readyState).toBe(WebSocket.OPEN);
    ws.close();
  });

  it("close() releases the PID lock", async () => {
    const home = await mkdtemp(join(tmpdir(), "pi-studio-boot-"));
    const handle = await bootstrap({
      env: { PI_STUDIO_HOME: home, PI_STUDIO_LISTEN: "127.0.0.1:0" },
    });
    const pidPath = join(home, "pi-studio.pid");
    expect(existsSync(pidPath)).toBe(true);
    await handle.close();
    expect(existsSync(pidPath)).toBe(false);
  });
});
