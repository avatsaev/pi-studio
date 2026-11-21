// The transport interface the workloads are written against, and its implementations.
//
// A transport is what `Transport` is in `packages/client/src/transport.ts`: `connect(url)` (resolves
// when the socket is open), `sendText(string)`, `sendBinary(Uint8Array)`, `close(code, reason)`,
// `isOpen`, `bufferedAmount`, and the handlers `onMessage(string | ArrayBuffer)`, `onClose(code,
// reason)` and `onError(error)`. `onMessage` is called once per WebSocket message, synchronously
// and in order, with a string for text and an ArrayBuffer for binary.
//
// A candidate bridge is one more entry in `TRANSPORTS`; the workloads and the runner do not change.

import { createBridgeTransport } from "./bridge.js";

/** The page's own `WebSocket`: what the app does today (the baseline). */
export function createWebSocketTransport() {
  let ws = null;
  const transport = {
    onMessage: null,
    onClose: null,
    onError: null,
    get isOpen() {
      return ws !== null && ws.readyState === 1;
    },
    get bufferedAmount() {
      return ws === null ? 0 : ws.bufferedAmount;
    },
    connect(url) {
      return new Promise((resolve, reject) => {
        ws = new WebSocket(url);
        // Synchronous delivery in wire order: a Blob would be decoded asynchronously, in no set order.
        ws.binaryType = "arraybuffer";
        ws.onopen = () => resolve();
        ws.onerror = (event) => {
          if (ws.readyState !== 1) reject(new Error(`cannot connect to ${url}`));
          else if (transport.onError) transport.onError(event);
        };
        ws.onclose = (event) => {
          if (transport.onClose) transport.onClose(event.code, event.reason);
        };
        ws.onmessage = (event) => {
          if (transport.onMessage) transport.onMessage(event.data);
        };
      });
    },
    sendText(data) {
      ws.send(data);
    },
    sendBinary(data) {
      ws.send(data);
    },
    close(code = 1000, reason = "") {
      if (ws !== null && ws.readyState < 2) ws.close(code, reason);
    },
    /** For a run that stalled: where the socket stands. */
    describe() {
      return ws === null ? "the socket was never created" : `the WebSocket is in readyState ${ws.readyState}, bufferedAmount ${ws.bufferedAmount}`;
    },
  };
  return transport;
}

/**
 * Every transport the benchmark measures, the baseline first. `create(options)` makes one connection's
 * transport; `bridge` marks the candidates (the baseline has no inbound window and no ordering of its
 * own to test). A candidate pair is one design: inbound and outbound the same way, per frame or batched.
 */
export const TRANSPORTS = [
  { id: "websocket", label: "the webview's WebSocket (what the app does today)", bridge: false, create: createWebSocketTransport },
  {
    id: "bridge-frame",
    label: "bridge: one channel message per frame in, one invoke per frame out",
    bridge: true,
    create: (options) => createBridgeTransport({ inbound: "frame", outbound: "frame", ...options }),
  },
  {
    id: "bridge-batch",
    label: "bridge: batches in (64 KiB or what the socket has), frames queued in one task out as one invoke",
    bridge: true,
    create: (options) => createBridgeTransport({ inbound: "batch", outbound: "batch", ...options }),
  },
];
