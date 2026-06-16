import { once } from "node:events";
import { createServer, type Server } from "node:http";
import { type AddressInfo } from "node:net";

import { afterEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";

import { type Session } from "./session.js";
import { createWebSocketServer, type WebSocketServerHandle } from "./ws-server.js";

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const fn of cleanups.toReversed()) await fn();
  cleanups.length = 0;
});

async function startServer(
  deps?: Partial<Parameters<typeof createWebSocketServer>[1]>,
): Promise<{ port: number; handle: WebSocketServerHandle; sessions: Session[] }> {
  const http: Server = createServer();
  const sessions: Session[] = [];
  const handle = createWebSocketServer(http, {
    serverId: "srv_test123",
    version: "9.9.9",
    onSession: (s) => sessions.push(s),
    ...deps,
  });
  await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", () => resolve()));
  const port = (http.address() as AddressInfo).port;
  cleanups.push(async () => {
    await handle.close();
    http.close();
  });
  return { port, handle, sessions };
}

function connect(port: number): Promise<WebSocket> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  return once(ws, "open").then(() => ws);
}

async function nextMessage(ws: WebSocket): Promise<unknown> {
  const [data] = (await once(ws, "message")) as [Buffer];
  return JSON.parse(data.toString());
}

const hello = (clientId: string, capabilities?: Record<string, boolean>) =>
  JSON.stringify({
    type: "hello",
    clientId,
    clientType: "cli",
    protocolVersion: 1,
    ...(capabilities ? { capabilities } : {}),
  });

describe("hello handshake", () => {
  it("returns status/server_info with serverId and features", async () => {
    const { port } = await startServer();
    const ws = await connect(port);
    ws.send(hello("client-1"));
    const msg = (await nextMessage(ws)) as {
      type: string;
      payload: { status: string; serverId: string; features: Record<string, boolean> };
    };
    expect(msg.type).toBe("status");
    expect(msg.payload.status).toBe("server_info");
    expect(msg.payload.serverId).toBe("srv_test123");
    expect(msg.payload.features.providersSnapshot).toBe(true);
    ws.close();
  });

  it("closes a connection whose first frame is not hello", async () => {
    const { port } = await startServer();
    const ws = await connect(port);
    ws.send(JSON.stringify({ type: "ping", requestId: "r1" }));
    const [code] = (await once(ws, "close")) as [number];
    expect(code).toBe(1008);
  });
});

describe("capability persistence + rehydrate", () => {
  it("rehydrates stored capabilities on reconnect when hello omits them", async () => {
    const { port, sessions } = await startServer();

    // First connection advertises a capability.
    const ws1 = await connect(port);
    ws1.send(hello("client-x", { custom_mode_icons: true }));
    await nextMessage(ws1);
    expect(sessions[0]?.supports("custom_mode_icons")).toBe(true);
    ws1.close();
    await once(ws1, "close");

    // Reconnect with the SAME clientId and NO capabilities → rehydrated from the store.
    const ws2 = await connect(port);
    ws2.send(hello("client-x"));
    await nextMessage(ws2);
    expect(sessions[1]?.supports("custom_mode_icons")).toBe(true);
    expect(sessions[1]?.supports("reasoning_merge_enum")).toBe(false);
    ws2.close();
  });
});

describe("post-handshake routing hook", () => {
  it("delivers subsequent frames to onMessage", async () => {
    const received: string[] = [];
    const { port } = await startServer({
      onMessage: (_s, frame) => {
        if ("text" in frame) received.push(frame.text);
      },
    });
    const ws = await connect(port);
    ws.send(hello("client-2"));
    await nextMessage(ws);
    ws.send(JSON.stringify({ type: "session", message: { type: "agent_list", agents: [] } }));
    await new Promise((r) => setTimeout(r, 30));
    expect(received).toHaveLength(1);
    ws.close();
  });
});
