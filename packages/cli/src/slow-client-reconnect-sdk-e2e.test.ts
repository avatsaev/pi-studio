import { once } from "node:events";
import { createServer, type Server } from "node:http";
import { type AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";

import {
  createWebSocketTransport,
  DaemonClient,
  ReconnectionManager,
  type AnyWebSocket,
} from "@av-pi-studio/client";
import { createWebSocketServer, type WebSocketServerHandle } from "@av-pi-studio/server";

/**
 * A client the daemon cut off for not reading (sprint-154/task-003) comes back on its own: a real
 * `DaemonClient` with the SDK's `ReconnectionManager`, over the Node `ws` transport, against the
 * real `createWebSocketServer`. Lives here because `cli` is the only package depending on both
 * client and server. The SDK reconnects on any close, so close code 1013 is not special to it; the
 * second case is the daemon's real cut-off (close, then terminate, so the client sees 1006).
 */

const MIB = 1024 * 1024;

let http: Server | undefined;
let handle: WebSocketServerHandle | undefined;
let client: DaemonClient | undefined;
let reconnection: ReconnectionManager | undefined;

afterEach(async () => {
  reconnection?.stop();
  reconnection = undefined;
  client?.close();
  client = undefined;
  await handle?.close();
  handle = undefined;
  http?.close();
  http = undefined;
});

function nextReconnection(manager: ReconnectionManager): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  manager.onReconnected(() => resolve());
  return promise;
}

async function startClient(): Promise<{ socket: () => WebSocket }> {
  http = createServer();
  handle = createWebSocketServer(http, { serverId: "srv_slow_sdk" });
  await once(http.listen(0, "127.0.0.1"), "listening");
  const { port } = http.address() as AddressInfo;

  let current: WebSocket | undefined;
  client = new DaemonClient({
    url: `ws://127.0.0.1:${port}`,
    clientId: "sdk-slow",
    clientType: "cli",
    transport: createWebSocketTransport((url) => {
      current = new WebSocket(url);
      return current as unknown as AnyWebSocket;
    }),
  });
  reconnection = new ReconnectionManager(client, { initialDelayMs: 10, jitter: 0 });
  reconnection.start();
  await client.connect();
  return { socket: () => current! };
}

describe("a DaemonClient the daemon cut off for not reading", () => {
  it("reconnects after a 1013 close and the daemon sees a fresh session", async () => {
    await startClient();
    const [first] = [...handle!.sessions];
    const reconnected = nextReconnection(reconnection!);

    first!.close(1013, "send queue full");
    await reconnected;

    expect(client!.state).toBe("open");
    expect(handle!.sessions.size).toBe(1);
    expect([...handle!.sessions][0]).not.toBe(first);
  });

  it("reconnects after the daemon terminates it for a full send queue", async () => {
    const { socket } = await startClient();
    const [first] = [...handle!.sessions];
    const stalled = socket();
    stalled.pause(); // stops reading: the daemon's queue for it grows past the cap
    const reconnected = nextReconnection(reconnection!);

    const pad = "x".repeat(MIB);
    for (let i = 0; i < 200 && first!.isOpen; i++)
      first!.send({ type: "session", message: { pad } });
    expect(first!.isOpen).toBe(false);
    stalled.resume();
    await reconnected;

    expect(client!.state).toBe("open");
    expect(handle!.sessions.size).toBe(1);
    expect([...handle!.sessions][0]).not.toBe(first);
  });
});
