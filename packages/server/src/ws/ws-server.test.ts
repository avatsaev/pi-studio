import { once } from "node:events";
import { createServer, type Server } from "node:http";
import { type AddressInfo } from "node:net";
import { homedir } from "node:os";

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
  it("returns status/server_info with serverId, features, and the daemon's home dir", async () => {
    const { port } = await startServer();
    const ws = await connect(port);
    ws.send(hello("client-1"));
    const msg = (await nextMessage(ws)) as {
      type: string;
      payload: {
        status: string;
        serverId: string;
        homeDir: string;
        features: Record<string, boolean>;
      };
    };
    expect(msg.type).toBe("status");
    expect(msg.payload.status).toBe("server_info");
    expect(msg.payload.serverId).toBe("srv_test123");
    expect(msg.payload.features.providersSnapshot).toBe(true);
    // The DAEMON's home dir, not the client's: this is the only way a browser (possibly on another
    // OS, where `/home/<name>` does not even exist) can expand a `~` cwd correctly.
    expect(msg.payload.homeDir).toBe(homedir());
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

describe("onSessionClose hook", () => {
  it("is invoked exactly once for a post-handshake session that disconnects", async () => {
    const closed: Session[] = [];
    const { promise: closedOnce, resolve } = Promise.withResolvers<void>();
    const { port } = await startServer({
      onSessionClose: (s) => {
        closed.push(s);
        resolve();
      },
    });
    const ws = await connect(port);
    ws.send(hello("client-close-1"));
    await nextMessage(ws);
    ws.close();
    await closedOnce;
    expect(closed).toHaveLength(1);
  });

  it("never fires for a socket that closes before completing the hello handshake", async () => {
    const closed: Session[] = [];
    const { port } = await startServer({ onSessionClose: (s) => closed.push(s) });
    const ws = await connect(port);
    const closedClientSide = once(ws, "close");
    ws.close(); // no hello sent — session is still null server-side, so nothing CAN fire here
    await closedClientSide;
    expect(closed).toHaveLength(0);
  });

  it("a throwing callback does not break socket teardown or sessions bookkeeping", async () => {
    const { promise: closeHandlerRan, resolve } = Promise.withResolvers<void>();
    const { port, handle } = await startServer({
      onSessionClose: () => {
        // Signal completion BEFORE throwing — resolves once ws-server.ts's close handler has
        // reached this point, which is after its `sessions.delete(session)` call.
        resolve();
        throw new Error("boom");
      },
    });
    const ws = await connect(port);
    ws.send(hello("client-close-2"));
    await nextMessage(ws);
    expect(handle.sessions.size).toBe(1);
    ws.close();
    await closeHandlerRan;
    // Teardown proceeded despite the throwing callback: the session was still removed.
    expect(handle.sessions.size).toBe(0);
  });
});
