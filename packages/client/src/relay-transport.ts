/**
 * Client-side relay E2EE transport (architecture/relay-e2ee.md § Pairing, § Behavior;
 * architecture/client-app-runtime.md § Layered client library — relay transport).
 *
 * `createRelayTransport(...)` implements the same {@link Transport} interface as
 * `createWebSocketTransport` (`./transport.js`), so `DaemonClient` can use either interchangeably —
 * "relay rides the same API" (see `index.ts`). Internally it connects to the relay endpoint,
 * registers under the given `sessionId` (matching the daemon's outbound registration in
 * `packages/server/src/daemon/relay-transport.ts`), generates a FRESH ephemeral Curve25519 keypair,
 * completes the `e2ee_hello`/`e2ee_ready` handshake via `createClientChannel`
 * (`@av-pi-studio/relay`), and only then reports the transport as open — no app RPC (including
 * `hello`) can cross the wire before the handshake finishes.
 *
 * TODO(verify): the relay's registration frame format matches
 * `packages/server/src/daemon/relay-transport.ts`'s choice (`{ type: "relay_register", sessionId
 * }`) — the real protocol is unresolved upstream (architecture/relay-e2ee.md § TODO(verify)).
 */
import { createClientChannel, type EncryptedChannel } from "@av-pi-studio/relay";

import type { Transport } from "./transport.js";
import { reasonString, type AnyWebSocket, type WsFactory } from "./transport.js";

export interface RelayTransportOptions {
  /** The relay rendezvous session id (obtained alongside the pairing offer / connection setup). */
  sessionId: string;
  /** The daemon's persistent Curve25519 public key, from the pairing offer — never a fresh key. */
  daemonPublicKey: Uint8Array;
  /** Inject a WebSocket factory (tests). Defaults to the global `WebSocket`. */
  factory?: WsFactory;
}

/**
 * Create a `Transport` that connects to a relay endpoint and carries app traffic E2EE. `connect(url)`
 * dials `url` (the relay's own WebSocket address, NOT the daemon's), registers `sessionId`, and
 * resolves only once the daemon's `e2ee_ready` arrives — mirroring `createWebSocketTransport`'s
 * contract of resolving once genuinely usable.
 */
export function createRelayTransport(opts: RelayTransportOptions): Transport {
  let ws: AnyWebSocket | null = null;
  let channel: EncryptedChannel | null = null;

  const self: Transport = {
    onMessage: null,
    onClose: null,
    onError: null,
    get isOpen(): boolean {
      return ws !== null && ws.readyState === 1 && channel !== null && channel.ready;
    },
    connect(url: string): Promise<void> {
      return new Promise<void>((resolve, reject) => {
        const create = opts.factory ?? (() => new WebSocket(url) as unknown as AnyWebSocket);
        try {
          ws = opts.factory ? create(url) : (new WebSocket(url) as unknown as AnyWebSocket);
        } catch (err) {
          reject(err);
          return;
        }
        const socket = ws;

        const messageHandlers: Array<(data: string) => void> = [];
        const closeHandlers: Array<(reason?: string) => void> = [];

        socket.onopen = () => {
          socket.send(JSON.stringify({ type: "relay_register", sessionId: opts.sessionId }));
          channel = createClientChannel({
            transport: {
              send: (data) => socket.send(data),
              onMessage: (h) => messageHandlers.push(h),
              onClose: (h) => closeHandlers.push(h),
              close: () => socket.close(),
            },
            attachment: { sessionId: opts.sessionId },
            daemonPublicKey: opts.daemonPublicKey,
            events: {
              onReady: () => resolve(),
              onMessage: (plaintext) => self.onMessage?.(plaintext),
              onAuthError: (err) => self.onError?.(err),
            },
          });
        };
        socket.onerror = (ev) => {
          if (socket.readyState !== 1) reject(ev);
          self.onError?.(ev);
        };
        socket.onclose = (ev) => {
          for (const h of closeHandlers) h(reasonString(ev.reason));
          self.onClose?.(ev.code, reasonString(ev.reason));
        };
        socket.onmessage = (ev) => {
          const { data } = ev;
          if (typeof data === "string") {
            for (const h of messageHandlers) h(data);
          }
          // Binary frames (terminal/file-transfer) are NOT E2EE-wrapped by this relay channel
          // protocol — architecture/relay-e2ee.md only specifies text-frame app messages. A future
          // sprint that needs binary-over-relay would extend the channel wire format; out of scope
          // here (see task file § Out of scope).
        };
      });
    },
    sendText(data: string): void {
      if (!channel || !channel.ready) {
        throw new Error("relay transport: cannot send before the E2EE handshake completes");
      }
      channel.send(data);
    },
    sendBinary(): void {
      throw new Error("relay transport: binary frames are not supported over the E2EE relay channel");
    },
    close(code = 1000, reason = ""): void {
      channel?.close();
      channel = null;
      ws?.close(code, reason);
      ws = null;
    },
  };
  return self;
}
