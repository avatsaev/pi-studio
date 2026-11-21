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

const messageOf = (error) => (error && error.message ? error.message : typeof error === "string" ? error : JSON.stringify(error));

/** One line for a run that stalled: what Rust's proxy has moved, held and refused, and how the connection ended. */
export function describeProxy(stats) {
  const end = stats.ended
    ? `ended by the ${stats.ended.by}${stats.ended.graceful ? " with a close handshake" : " without one"}${stats.ended.code === null || stats.ended.code === undefined ? "" : `, code ${stats.ended.code}`}${
        stats.ended.reason ? ` (${stats.ended.reason})` : ""
      }`
    : "the connection is still open";
  const stalled = stats.stalledAtServerFedBytes === null || stats.stalledAtServerFedBytes === undefined ? "no write to the page stalled" : `the first stalled write came when the server had sent ${stats.stalledAtServerFedBytes} bytes`;
  return (
    `Rust moved ${stats.framesToPage} frames (${stats.bytesToPage} bytes) to the page and ${stats.framesToServer} frames (${stats.bytesToServer} bytes) to the server; ` +
    `it holds ${stats.outstanding} bytes now, ${stats.maxOutstanding} at most (to the server ${stats.maxHeldToServer}); ${stats.stalls} stalled writes to the page, the longest write ${stats.maxWriteMs} ms; ${stalled}; ` +
    `${stats.refusals} upgrades refused${stats.refused && stats.refused.length > 0 ? ` (${stats.refused.join(" | ")})` : ""}; ${end}`
  );
}

/**
 * The proxy transport: the page's own `WebSocket` (the baseline's code), connected to a loopback port that Rust
 * opens for it (`proxy_open`), behind which Rust holds the real socket. Everything the baseline does (`onMessage`
 * in wire order, `bufferedAmount`) is the webview's, so the workloads read the same numbers; `stats()` and
 * `report()` are Rust's counters of the connection (`ipc` of a run's record), `maxOutstanding` being the most bytes Rust
 * held between the two sockets.
 *
 * @param {{ invoke: Function }} tauri `window.__TAURI__.core`, or a stand-in in tests
 * @param {string} origin the page's origin (`location.origin`), for the message of a refused upgrade
 */
export function createProxyTransport(tauri = window.__TAURI__.core, origin = typeof location === "undefined" ? "" : location.origin) {
  const { invoke } = tauri;
  const transport = createWebSocketTransport();
  const connectSocket = transport.connect;
  let id = null;

  transport.proxy = true;
  transport.connect = async (url) => {
    let opened;
    try {
      opened = await invoke("proxy_open", { url });
    } catch (error) {
      throw new Error(messageOf(error));
    }
    id = opened.id;
    try {
      await connectSocket(opened.url);
    } catch {
      // The token is spent either way and stays out of the message; Rust says why it refused the upgrade.
      const stats = await invoke("proxy_stats", { id }).catch(() => null);
      const why = stats ? `Rust expects the origin ${stats.expectedOrigin} and refused: ${stats.refused.join(" | ") || "nothing"}` : "Rust's counters are not available";
      throw new Error(`the page's WebSocket to the proxy did not open (the page's origin is ${origin}); ${why}`);
    }
  };
  transport.stats = () => {
    if (id === null) return Promise.reject(new Error("the proxy connection was not opened"));
    return invoke("proxy_stats", { id });
  };
  transport.report = async () => ({ ...(await transport.stats()), ipcPath: "loopback WebSocket (Rust proxy)", outOfOrder: 0, pageOrigin: origin });
  const socketState = transport.describe;
  transport.describe = async () => {
    try {
      return `${describeProxy(await transport.stats())}; ${socketState()}`;
    } catch (error) {
      return `the proxy's counters are not available: ${messageOf(error)}; ${socketState()}`;
    }
  };
  return transport;
}

/**
 * Every transport the benchmark measures, the baseline first. `create(options)` makes one connection's
 * transport; `bridge` marks the candidates that go over Tauri IPC (the baseline has no inbound window and no
 * ordering of its own to test), `proxy` the one that goes over a loopback WebSocket owned by Rust. A bridge pair
 * is one design: inbound and outbound the same way, per frame or batched.
 */
export const TRANSPORTS = [
  { id: "websocket", label: "the webview's WebSocket (what the app does today)", bridge: false, create: () => createWebSocketTransport() },
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
  {
    id: "proxy-ws",
    label: "proxy: Rust owns the socket; the page's WebSocket talks to a loopback WebSocket proxy in Rust",
    bridge: false,
    proxy: true,
    create: () => createProxyTransport(),
  },
];
