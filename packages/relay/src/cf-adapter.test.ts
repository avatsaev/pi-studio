import { describe, expect, it } from "vitest";

import { RelaySessionBridge } from "./session-bridge.js";
import { createCloudflareRelayHandler, type CfWebSocket, type CfWebSocketPair } from "./cf-adapter.js";

/**
 * Tests the Cloudflare Workers adapter's structural wrapper. Since the real `WebSocketPair`
 * only exists inside the Workers runtime, this constructs a minimal fake pair satisfying the
 * `CfWebSocket` structural interface and asserts the adapter wires it into `RelaySessionBridge`
 * exactly as a real deployment would — proving the bridging behavior (already fully verified
 * against real WebSocket connections in `session-bridge.test.ts`) is reachable through this
 * Workers-shaped entry point.
 */

function createFakeCfWebSocketPair(): {
  pair: CfWebSocketPair;
  clientSideHandlers: { message: Array<(ev: { data: string }) => void>; close: Array<(ev: { code: number; reason: string }) => void> };
  serverSideHandlers: { message: Array<(ev: { data: string }) => void>; close: Array<(ev: { code: number; reason: string }) => void> };
  accepted: { value: boolean };
} {
  const clientSideHandlers = {
    message: [] as Array<(ev: { data: string }) => void>,
    close: [] as Array<(ev: { code: number; reason: string }) => void>,
  };
  const serverSideHandlers = {
    message: [] as Array<(ev: { data: string }) => void>,
    close: [] as Array<(ev: { code: number; reason: string }) => void>,
  };
  const accepted = { value: false };

  // "client" and "server" are directly wired to each other, simulating the real Workers
  // WebSocketPair's paired-socket semantics: sending on one delivers to the other's listeners.
  const client: CfWebSocket = {
    accept: () => {},
    send: (data) => {
      for (const h of serverSideHandlers.message) h({ data });
    },
    addEventListener: (type, listener) => {
      if (type === "message") clientSideHandlers.message.push(listener as (ev: { data: string }) => void);
      else clientSideHandlers.close.push(listener as (ev: { code: number; reason: string }) => void);
    },
    close: (code = 1000, reason = "") => {
      for (const h of clientSideHandlers.close) h({ code, reason });
    },
  };
  const server: CfWebSocket = {
    accept: () => {
      accepted.value = true;
    },
    send: (data) => {
      for (const h of clientSideHandlers.message) h({ data });
    },
    addEventListener: (type, listener) => {
      if (type === "message") serverSideHandlers.message.push(listener as (ev: { data: string }) => void);
      else serverSideHandlers.close.push(listener as (ev: { code: number; reason: string }) => void);
    },
    close: (code = 1000, reason = "") => {
      for (const h of serverSideHandlers.close) h({ code, reason });
    },
  };

  return { pair: [client, server] as const, clientSideHandlers, serverSideHandlers, accepted };
}

describe("Cloudflare relay adapter", () => {
  it("rejects a non-WebSocket upgrade request with 400 and no socket", () => {
    const bridge = new RelaySessionBridge();
    const handle = createCloudflareRelayHandler({ bridge, createWebSocketPair: () => createFakeCfWebSocketPair().pair });

    expect(handle(null)).toEqual({ status: 400 });
    expect(handle("keep-alive")).toEqual({ status: 400 });
  });

  it("accepts a WebSocket upgrade: accepts the server side, attaches it to the bridge, returns the client side with 101", () => {
    const bridge = new RelaySessionBridge();
    const fake = createFakeCfWebSocketPair();
    const handle = createCloudflareRelayHandler({ bridge, createWebSocketPair: () => fake.pair });

    const result = handle("websocket");
    expect(result.status).toBe(101);
    expect(result.webSocket).toBe(fake.pair[0]); // the CLIENT side is returned to the caller
    expect(fake.accepted.value).toBe(true); // the SERVER side was `.accept()`-ed

    // The server side is now bridge-attached. Simulate a real message arriving at it: in the
    // WebSocketPair model, `client.send()` delivers to the SERVER's listeners (the two ends are
    // cross-wired) — so `fake.pair[0].send()` is what a real browser-side WebSocket write would
    // produce arriving at the Worker's accepted socket.
    fake.pair[0].send(JSON.stringify({ type: "relay_register", sessionId: "sess-cf-1" }));
    expect(bridge.peerCount("sess-cf-1")).toBe(1);
  });

  it("forwards frames verbatim between two Workers-adapter-accepted sockets sharing a session id", () => {
    const bridge = new RelaySessionBridge();
    const fakeA = createFakeCfWebSocketPair();
    const fakeB = createFakeCfWebSocketPair();
    const handle = createCloudflareRelayHandler({ bridge, createWebSocketPair: () => fakeA.pair });
    const handleB = createCloudflareRelayHandler({ bridge, createWebSocketPair: () => fakeB.pair });

    handle("websocket");
    handleB("websocket");

    fakeA.pair[0].send(JSON.stringify({ type: "relay_register", sessionId: "sess-cf-2" }));
    fakeB.pair[0].send(JSON.stringify({ type: "relay_register", sessionId: "sess-cf-2" }));
    expect(bridge.peerCount("sess-cf-2")).toBe(2);

    const receivedByB: string[] = [];
    // The bridge forwards by calling the server-side socket's `.send()`, which — in the
    // WebSocketPair cross-wiring — delivers to the CLIENT side's listeners (the real browser/
    // daemon socket on the other end of this pair).
    fakeB.clientSideHandlers.message.push((ev) => receivedByB.push(ev.data));
    fakeA.pair[0].send("hello-through-cf-adapter");
    expect(receivedByB).toEqual(["hello-through-cf-adapter"]);
  });

  it("throws a clear error when no WebSocketPair is available and none was injected", () => {
    const bridge = new RelaySessionBridge();
    const handle = createCloudflareRelayHandler({ bridge });
    expect(() => handle("websocket")).toThrow(/WebSocketPair/);
  });
});
