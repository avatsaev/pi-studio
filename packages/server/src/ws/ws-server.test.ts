import { once } from "node:events";
import { createServer, type Server } from "node:http";
import { type AddressInfo } from "node:net";
import { homedir } from "node:os";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type ClientOptions, WebSocket } from "ws";

import { DaemonStatusService } from "../observability/daemon-status-service.js";
import { MAX_FRAME_BYTES, PING_INTERVAL_MS } from "./limits.js";
import { type Session } from "./session.js";
import {
  createWebSocketServer,
  SOCKET_CLOSE_GRACE_MS,
  type WebSocketServerHandle,
} from "./ws-server.js";

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

function connect(port: number, options?: ClientOptions): Promise<WebSocket> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`, options);
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

  it("stores hello.platform on the session, and drops a bad one without failing the handshake", async () => {
    const { port, sessions } = await startServer();
    const withPlatform = await connect(port);
    withPlatform.send(
      JSON.stringify({
        type: "hello",
        clientId: "desk-1",
        clientType: "browser",
        platform: "desktop",
        protocolVersion: 1,
      }),
    );
    expect(((await nextMessage(withPlatform)) as { type: string }).type).toBe("status");
    expect(sessions[0]?.platform).toBe("desktop");

    const bad = await connect(port);
    bad.send(
      JSON.stringify({
        type: "hello",
        clientId: "desk-2",
        clientType: "browser",
        platform: 42,
        protocolVersion: 1,
      }),
    );
    expect(((await nextMessage(bad)) as { type: string }).type).toBe("status");
    expect(sessions[1]?.platform).toBeUndefined();

    const plain = await connect(port);
    plain.send(hello("plain-1"));
    await nextMessage(plain);
    expect(sessions[2]?.platform).toBeUndefined();
    withPlatform.close();
    bad.close();
    plain.close();
  });

  it("stores hello.agentStreams on the session; an absent or invalid value means all", async () => {
    const { port, sessions } = await startServer();
    const sockets = [];
    for (const [i, agentStreams] of ["none", "all", "sometimes", 7, undefined].entries()) {
      const ws = await connect(port);
      ws.send(
        JSON.stringify({
          type: "hello",
          clientId: `streams-${i}`,
          clientType: "browser",
          protocolVersion: 1,
          ...(agentStreams === undefined ? {} : { agentStreams }),
        }),
      );
      expect(((await nextMessage(ws)) as { type: string }).type).toBe("status");
      sockets.push(ws);
    }
    expect(sessions.map((s) => s.agentStreams)).toEqual(["none", "all", "all", "all", "all"]);
    for (const ws of sockets) ws.close();
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

describe("socket limits", () => {
  it("closes a socket that never sends hello at the limit, and keeps one that did", async () => {
    const { port, sessions } = await startServer({ helloTimeoutMs: 100 });
    const silent = await connect(port);
    const talker = await connect(port);
    talker.send(hello("on-time"));
    await nextMessage(talker);

    const [code, reason] = (await once(silent, "close")) as [number, Buffer];
    expect(code).toBe(1008);
    expect(reason.toString()).toBe("hello timeout");
    expect(talker.readyState).toBe(WebSocket.OPEN);
    expect(sessions).toHaveLength(1);
    talker.close();
  });

  it("closes a socket that sends an oversize frame with 1009 and leaves other sessions alone", async () => {
    const received: Array<{ clientId: string; frame: unknown }> = [];
    const { port, handle } = await startServer({
      onMessage: (s, frame) => void received.push({ clientId: s.clientId, frame }),
    });
    const big = await connect(port);
    big.send(hello("big"));
    await nextMessage(big);
    const other = await connect(port);
    other.send(hello("other"));
    await nextMessage(other);
    expect(handle.sessions.size).toBe(2);

    big.send(Buffer.alloc(MAX_FRAME_BYTES + 1));
    const [code] = (await once(big, "close")) as [number];
    expect(code).toBe(1009);
    expect(received).toEqual([]);

    other.send(JSON.stringify({ type: "ping" }));
    await vi.waitFor(() => expect(received).toHaveLength(1));
    expect(received[0]?.clientId).toBe("other");
    expect(other.readyState).toBe(WebSocket.OPEN);
    await vi.waitFor(() => expect(handle.sessions.size).toBe(1));
    other.close();
  });

  it("hands a binary frame to onMessage with its bytes intact", async () => {
    const bytes = Uint8Array.from({ length: 4096 }, (_, i) => i % 251);
    const frames: Uint8Array[] = [];
    const { port } = await startServer({
      onMessage: (_s, frame) => {
        if ("binary" in frame) frames.push(frame.binary);
      },
    });
    const ws = await connect(port);
    ws.send(hello("binary"));
    await nextMessage(ws);
    ws.send(bytes);
    ws.send(bytes.subarray(10, 20));
    await vi.waitFor(() => expect(frames).toHaveLength(2));
    expect([...frames[0]!]).toEqual([...bytes]);
    expect([...frames[1]!]).toEqual([...bytes.subarray(10, 20)]);
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

const helloWith = (clientId: string, appVersion?: string) =>
  JSON.stringify({
    type: "hello",
    clientId,
    clientType: "cli",
    protocolVersion: 1,
    ...(appVersion ? { appVersion } : {}),
  });

describe("Session connection metadata (sprint-084/task-003)", () => {
  it("retains hello.appVersion, peer address, transport and connectedAt on the Session", async () => {
    const before = Date.now();
    const { port, sessions } = await startServer();
    const ws = await connect(port);
    ws.send(helloWith("meta-1", "pistudiodashboard/0.1.0"));
    await nextMessage(ws);
    const s = sessions[0]!;
    expect(s.appVersion).toBe("pistudiodashboard/0.1.0");
    expect(s.transport).toBe("direct");
    expect(s.remoteAddress).toMatch(/127\.0\.0\.1$/);
    expect(s.connectedAt).toBeGreaterThanOrEqual(before);
    expect(s.connectedAt).toBeLessThanOrEqual(Date.now());
    ws.close();
  });

  it("leaves appVersion undefined when the hello omits it, and never writes it to the capability store", async () => {
    const stored = new Map<string, Record<string, boolean>>();
    const { port, sessions } = await startServer({
      capabilityStore: {
        get: (id) => stored.get(id),
        set: (id, caps) => void stored.set(id, caps),
      },
    });
    const ws = await connect(port);
    ws.send(helloWith("meta-2"));
    await nextMessage(ws);
    expect(sessions[0]!.appVersion).toBeUndefined();
    ws.close();
    const ws2 = await connect(port);
    ws2.send(helloWith("meta-3", "x/1"));
    await nextMessage(ws2);
    expect(stored.get("meta-3")).toEqual({});
    ws2.close();
  });
});

function upgradeStatus(port: number, headers?: Record<string, string>): Promise<number> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`, { headers });
  return new Promise((resolve) => {
    ws.once("open", () => {
      ws.close();
      resolve(101);
    });
    ws.once("unexpected-response", (_req, res) => resolve(res.statusCode ?? 0));
    ws.once("error", () => undefined);
  });
}

describe("upgrade Origin policy", () => {
  it("refuses a foreign Origin with 403 and creates no session", async () => {
    const { port, sessions } = await startServer();
    expect(await upgradeStatus(port, { Origin: "https://evil.example" })).toBe(403);
    expect(sessions).toHaveLength(0);
  });

  it("accepts an upgrade with no Origin", async () => {
    const { port } = await startServer();
    expect(await upgradeStatus(port)).toBe(101);
  });

  it("accepts an allowlisted Origin (exact match only)", async () => {
    const { port } = await startServer({ allowedOrigins: ["http://localhost:5173"] });
    expect(await upgradeStatus(port, { Origin: "http://localhost:5173" })).toBe(101);
    expect(await upgradeStatus(port, { Origin: "http://localhost:5174" })).toBe(403);
    expect(await upgradeStatus(port, { Origin: "https://localhost:5173" })).toBe(403);
  });

  it("still enforces the Host check and the password for an allowed Origin", async () => {
    const { port } = await startServer({
      allowedOrigins: ["http://localhost:5173"],
      hostCheck: () => false,
    });
    expect(await upgradeStatus(port, { Origin: "http://localhost:5173" })).toBe(403);
    const authed = await startServer({
      allowedOrigins: ["http://localhost:5173"],
      auth: { authenticateUpgrade: () => false } as never,
    });
    expect(await upgradeStatus(authed.port, { Origin: "http://localhost:5173" })).toBe(401);
    expect(await upgradeStatus(authed.port)).toBe(401);
  });
});

describe("shutdown", () => {
  /** A connected client that completed the handshake. */
  async function handshaken(port: number, clientId: string): Promise<WebSocket> {
    const ws = await connect(port);
    ws.send(hello(clientId));
    await nextMessage(ws);
    return ws;
  }

  it("stopAccepting() refuses later upgrades with 503 and leaves a connected client alone", async () => {
    const { port, handle, sessions } = await startServer();
    const ws = await handshaken(port, "before");
    expect(sessions).toHaveLength(1);

    handle.stopAccepting();

    expect(await upgradeStatus(port)).toBe(503);
    expect(sessions).toHaveLength(1);
    expect(ws.readyState).toBe(WebSocket.OPEN);
    ws.close();
  });

  it("close() closes every connected client with 1001, one that has not said hello included", async () => {
    const { port, handle } = await startServer();
    const greeted = await handshaken(port, "greeted");
    const silent = await connect(port);
    const greetedClosed = once(greeted, "close");
    const silentClosed = once(silent, "close");

    await handle.close();

    expect((await greetedClosed)[0]).toBe(1001);
    expect((await silentClosed)[0]).toBe(1001);
    expect(await upgradeStatus(port)).toBe(503);
  });

  it("close() resolves at once when no client is connected", async () => {
    const { handle } = await startServer();
    await handle.close();
  });

  it("close() terminates a client that never answers the close frame once the grace has passed", async () => {
    const { port, handle } = await startServer();
    const ws = await handshaken(port, "half-open");
    expect(handle.sessions.size).toBe(1);
    // The client reads nothing from now on, so it never answers the close frame (without the
    // grace the server would wait for the `ws` library's own 30 s closing timeout).
    ws.pause();

    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      let settled = false;
      const closing = handle.close().then(() => {
        settled = true;
      });
      await vi.advanceTimersByTimeAsync(SOCKET_CLOSE_GRACE_MS - 1);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      await closing;
      expect(settled).toBe(true);
      expect(handle.sessions.size).toBe(0);
    } finally {
      vi.useRealTimers();
      ws.terminate();
    }
  });
});

describe("liveness", () => {
  const INTERVAL_MS = 1_000;

  // Only the sweep's interval is faked: sockets keep their real timers and every wait below is an
  // event, so a test never depends on how fast the loopback is.
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  /** A client that completed the handshake. `autoPong: false` makes it a peer that never answers a ping. */
  async function greeted(
    port: number,
    clientId: string,
    options?: ClientOptions,
  ): Promise<WebSocket> {
    const ws = await connect(port, options);
    ws.send(hello(clientId));
    await nextMessage(ws);
    return ws;
  }

  /**
   * One interval of the sweep. Resolves once every client in `clients` has received its ping and
   * the server has read `answers` pongs (the ping a client does not answer sends none).
   */
  async function interval(
    handle: WebSocketServerHandle,
    clients: WebSocket[],
    answers: number,
  ): Promise<void> {
    const pinged = clients.map((client) => once(client, "ping"));
    const { promise: answered, resolve } = Promise.withResolvers<void>();
    let seen = 0;
    if (answers === 0) resolve();
    for (const server of handle.wss.clients) {
      server.once("pong", () => {
        if (++seen === answers) resolve();
      });
    }
    vi.advanceTimersByTime(INTERVAL_MS);
    await Promise.all([...pinged, answered]);
  }

  it("pings every 30 s by default", () => {
    expect(PING_INTERVAL_MS).toBe(30_000);
  });

  it("terminates a client that never answers a ping within two intervals and drops it from daemon_status", async () => {
    const closed: string[] = [];
    const { promise: gone, resolve } = Promise.withResolvers<void>();
    const { port, handle } = await startServer({
      pingIntervalMs: INTERVAL_MS,
      onSessionClose: (s) => {
        closed.push(s.clientId);
        resolve();
      },
    });
    const status = new DaemonStatusService({
      listAgents: () => [],
      getActiveSessions: () => [...handle.sessions],
      send: () => {},
    });
    const listed = (): string[] =>
      status
        .oneShot()
        .clients.map((c) => c.clientId)
        .toSorted();
    const mute = await greeted(port, "mute", { autoPong: false });
    const steady = await greeted(port, "steady");
    expect(listed()).toEqual(["mute", "steady"]);

    await interval(handle, [mute, steady], 1);
    expect(mute.readyState).toBe(WebSocket.OPEN);
    expect(closed).toEqual([]);

    const muteClosed = once(mute, "close");
    vi.advanceTimersByTime(INTERVAL_MS);
    const [code] = (await muteClosed) as [number];
    await gone;

    expect(code).toBe(1006);
    expect(closed).toEqual(["mute"]);
    expect(listed()).toEqual(["steady"]);
    expect(steady.readyState).toBe(WebSocket.OPEN);
    steady.close();
  });

  it("keeps a client that answers its pings across many intervals", async () => {
    const { port, handle } = await startServer({ pingIntervalMs: INTERVAL_MS });
    const client = await greeted(port, "steady");
    let pings = 0;
    client.on("ping", () => void pings++);
    expect(pings).toBe(0);

    for (let round = 1; round <= 6; round++) {
      await interval(handle, [client], 1);
      expect(pings).toBe(round);
    }

    expect(client.readyState).toBe(WebSocket.OPEN);
    expect(handle.sessions.size).toBe(1);
    client.close();
  });

  it("counts any message as a sign of life, so a client that sends but never answers a ping stays", async () => {
    const { port, handle } = await startServer({
      pingIntervalMs: INTERVAL_MS,
      onMessage: (session) => session.send({ type: "heard" }),
    });
    const chatty = await greeted(port, "chatty", { autoPong: false });

    for (let round = 0; round < 5; round++) {
      await interval(handle, [chatty], 0);
      chatty.send(JSON.stringify({ type: "ping" }));
      expect(await nextMessage(chatty)).toEqual({ type: "heard" });
    }

    expect(chatty.readyState).toBe(WebSocket.OPEN);
    expect(handle.sessions.size).toBe(1);
    chatty.close();
  });

  it("does not judge a socket the server has stopped reading (an upload's back-pressure)", async () => {
    const { port, handle } = await startServer({ pingIntervalMs: INTERVAL_MS });
    const client = await greeted(port, "uploading");
    const server = [...handle.wss.clients][0]!;
    // Nothing the client sends is read while paused, so it cannot show life.
    server.pause();
    vi.advanceTimersByTime(INTERVAL_MS * 4);
    expect(server.readyState).toBe(WebSocket.OPEN);

    // Reading again, it is pinged and judged like any other socket.
    server.resume();
    await interval(handle, [client], 1);
    await interval(handle, [client], 1);
    expect(server.readyState).toBe(WebSocket.OPEN);
    expect(handle.sessions.size).toBe(1);
    client.close();
  });

  it("close() stops the sweep", async () => {
    const { handle } = await startServer({ pingIntervalMs: INTERVAL_MS });
    expect(vi.getTimerCount()).toBe(1);

    await handle.close();

    expect(vi.getTimerCount()).toBe(0);
  });
});
