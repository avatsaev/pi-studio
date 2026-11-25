import { once } from "node:events";
import { createServer, type Server } from "node:http";
import { type AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";

import {
  createWebSocketTransport,
  DaemonClient,
  type AnyWebSocket,
  type ConnectionState,
} from "@av-pi-studio/client";
import { createWebSocketServer, type WebSocketServerHandle } from "@av-pi-studio/server";

/**
 * The daemon's protocol-level pings against the SDK (sprint-154/task-002): a real `DaemonClient`
 * over the Node `ws` transport, connected to the real `createWebSocketServer`, must stay connected
 * while the server pings and judges it every interval. Lives here because `cli` is the only package
 * depending on both client and server. Only the sweep's interval is faked; every wait is an event.
 */

const INTERVAL_MS = 1_000;
const ROUNDS = 6;

let http: Server | undefined;
let handle: WebSocketServerHandle | undefined;
let client: DaemonClient | undefined;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
});

afterEach(async () => {
  client?.close();
  client = undefined;
  await handle?.close();
  handle = undefined;
  http?.close();
  http = undefined;
  vi.useRealTimers();
});

describe("a DaemonClient on the Node ws transport", () => {
  it("stays connected across many ping intervals of the daemon", async () => {
    http = createServer();
    handle = createWebSocketServer(http, { serverId: "srv_liveness", pingIntervalMs: INTERVAL_MS });
    await once(http.listen(0, "127.0.0.1"), "listening");
    const { port } = http.address() as AddressInfo;

    let socket: WebSocket | undefined;
    client = new DaemonClient({
      url: `ws://127.0.0.1:${port}`,
      clientId: "sdk-liveness",
      clientType: "cli",
      transport: createWebSocketTransport((url) => {
        socket = new WebSocket(url);
        return socket as unknown as AnyWebSocket;
      }),
    });
    const states: ConnectionState[] = [];
    client.onStateChange((state) => states.push(state));
    await client.connect();
    expect(states.at(-1)).toBe("open");
    const onTheServer = [...handle.wss.clients][0]!;

    for (let round = 0; round < ROUNDS; round++) {
      const pinged = once(socket!, "ping");
      const answered = once(onTheServer, "pong");
      vi.advanceTimersByTime(INTERVAL_MS);
      await Promise.all([pinged, answered]);
    }

    expect(client.state).toBe("open");
    expect(states).not.toContain("closed");
    expect(handle.sessions.size).toBe(1);
  });
});
