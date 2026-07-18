/**
 * Cloudflare Workers adapter (architecture/relay-e2ee.md § Channel API — "Cloudflare adapter |
 * server | Relay server implementation hook for Cloudflare Workers"; § Purpose).
 *
 * Wraps a Cloudflare Workers `WebSocketPair` into the platform-agnostic `RelaySessionBridge`
 * (`session-bridge.ts`) so a Workers `fetch` handler can accept a WebSocket upgrade and hand the
 * server-side socket to the bridge with three lines of code. This module deliberately avoids a
 * hard dependency on `@cloudflare/workers-types` (which would collide with this package's `"node"`
 * ambient types and pull in a large type-only surface for a library package with zero runtime
 * deps) — instead it declares the minimal STRUCTURAL shape it actually uses
 * ({@link CfWebSocket}/{@link CfWebSocketPair}), which the real Workers runtime's objects satisfy
 * naturally. A real deployment supplies the actual Workers globals; this adapter only needs
 * `accept`/`send`/`addEventListener`/`close`.
 *
 * Hosted deployment/ops (wrangler config, the actual `fetch` export's `Request`/`Response`
 * wiring) is explicitly out of scope for this task — see the task file § Out of scope. What's
 * built here is the reusable bridging hook a `fetch` handler wires the upgrade through.
 */
import { RelaySessionBridge, type RelaySocket } from "./session-bridge.js";

/** Structural subset of the real Cloudflare Workers `WebSocket` this adapter depends on. */
export interface CfWebSocket {
  accept(): void;
  send(data: string): void;
  addEventListener(type: "message", listener: (ev: { data: string }) => void): void;
  addEventListener(type: "close", listener: (ev: { code: number; reason: string }) => void): void;
  close(code?: number, reason?: string): void;
}

/** Structural subset of the real Cloudflare Workers `WebSocketPair` (a 2-tuple: [client, server]). */
export type CfWebSocketPair = readonly [CfWebSocket, CfWebSocket];

export type WebSocketPairFactory = () => CfWebSocketPair;

export interface CloudflareRelayAdapterOptions {
  bridge: RelaySessionBridge;
  /**
   * Injectable for tests. Defaults to the global `WebSocketPair` constructor, which only exists
   * in the real Cloudflare Workers runtime — omit this in production; supply a fake in tests.
   */
  createWebSocketPair?: WebSocketPairFactory;
}

/** Wrap a Workers-side `CfWebSocket` (already `.accept()`-ed) as the bridge's `RelaySocket`. */
function wrapCfSocket(ws: CfWebSocket): RelaySocket {
  return {
    send: (data) => ws.send(data),
    onMessage: (handler) => ws.addEventListener("message", (ev) => handler(ev.data)),
    onClose: (handler) => ws.addEventListener("close", (ev) => handler(ev.reason)),
    close: (code, reason) => ws.close(code, reason),
  };
}

export interface UpgradeResult {
  /** HTTP status the caller's `fetch` handler should respond with (101 on success). */
  status: number;
  /** The CLIENT-side socket to return to the browser via `new Response(null, { webSocket, status: 101 })`. */
  webSocket?: CfWebSocket;
}

/**
 * Create the relay's WebSocket-upgrade handler. A real Workers `fetch` export calls this with the
 * incoming `Upgrade` header value; on a valid WebSocket upgrade it creates a `WebSocketPair`,
 * accepts the SERVER side, attaches it to `bridge` (so it starts participating in session
 * pairing/bridging per `session-bridge.ts`), and returns the CLIENT side for the caller to hand
 * back in the 101 response. Non-WebSocket requests return a 400 with no socket.
 */
export function createCloudflareRelayHandler(
  opts: CloudflareRelayAdapterOptions,
): (upgradeHeader: string | null) => UpgradeResult {
  const { bridge } = opts;
  const createPair =
    opts.createWebSocketPair ??
    (() => {
      const Ctor = (globalThis as { WebSocketPair?: new () => CfWebSocketPair }).WebSocketPair;
      if (!Ctor) {
        throw new Error(
          "createCloudflareRelayHandler: no WebSocketPair available — inject `createWebSocketPair` outside a real Workers runtime",
        );
      }
      return new Ctor();
    });

  return (upgradeHeader: string | null): UpgradeResult => {
    if (!upgradeHeader || upgradeHeader.toLowerCase() !== "websocket") {
      return { status: 400 };
    }
    const [client, server] = createPair();
    server.accept();
    bridge.attach(wrapCfSocket(server));
    return { status: 101, webSocket: client };
  };
}
