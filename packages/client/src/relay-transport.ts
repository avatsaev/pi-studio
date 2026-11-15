/**
 * Client-side relay E2EE transport, protocol 2 (architecture/relay-protocol.md § Behavior —
 * Client, §§ 2–4; features/relay-multi-client.md § Public contract 3).
 *
 * `createRelayTransport(...)` implements the same {@link Transport} interface as
 * `createWebSocketTransport` (`./transport.js`), so `DaemonClient` can use either interchangeably.
 * `connect(url)` opens one socket to the relay, sends `relay_client_connect { v: 2, sessionId }`,
 * waits for `relay_paired`, then runs `createClientChannel` (`@av-pi-studio/relay`) over the same
 * socket — a FRESH ephemeral Curve25519 keypair per connect, `hello`/`ready` handshake — and
 * reports the transport open only once the `ready` box has opened. No app RPC (including `hello`)
 * can cross the wire before then. After that, text and binary are channel records, each one binary
 * WebSocket frame (no base64).
 *
 * `connect` never hangs: it settles within `connectTimeoutMs` (default 15 s) and every failure is
 * a {@link RelayConnectError} whose `reason` and message tell the user what to do.
 */
import {
  createClientChannel,
  deriveRelaySessionId,
  parseRelayFrame,
  RELAY_CLOSE,
  RELAY_DEFAULTS,
  type Channel,
} from "@av-pi-studio/relay";

import type { Transport } from "./transport.js";
import { reasonString, type AnyWebSocket, type WsFactory } from "./transport.js";

export type RelayConnectReason =
  | "daemon_offline"
  | "daemon_unresponsive"
  | "too_many_clients"
  | "daemon_outdated"
  | "timeout"
  | "wrong_key"
  | "relay_unreachable"
  | "protocol_error";

const REASON_MESSAGES: Record<RelayConnectReason, string> = {
  daemon_offline:
    "The daemon is not connected to the relay: it may be offline, or its key replaced, so this pairing link is no longer valid.",
  daemon_unresponsive: "The daemon did not answer through the relay.",
  too_many_clients: "The daemon already has the maximum number of relay connections.",
  daemon_outdated: "The daemon speaks an older relay protocol and must be updated.",
  timeout: "The relay did not answer in time; a self-hosted relay may need updating.",
  wrong_key: "The pairing link does not match this daemon.",
  relay_unreachable: "The relay could not be reached.",
  protocol_error: "The relay connection failed with a protocol error.",
};

/** A failed `connect()`: `reason` is the machine-readable cause, `message` is fit to show a user. */
export class RelayConnectError extends Error {
  readonly reason: RelayConnectReason;

  constructor(reason: RelayConnectReason, detail?: string) {
    super(detail ? `${REASON_MESSAGES[reason]} (${detail})` : REASON_MESSAGES[reason]);
    this.name = "RelayConnectError";
    this.reason = reason;
  }
}

export interface RelayTransportOptions {
  /**
   * The relay rendezvous session id. Optional — defaults to
   * `deriveRelaySessionId(daemonPublicKey)`, the SAME deterministic id the daemon registers under,
   * so a pairing offer's public key alone is enough to find the daemon on the relay.
   */
  sessionId?: string;
  /** The daemon's persistent Curve25519 public key, from the pairing offer — never a fresh key. */
  daemonPublicKey: Uint8Array;
  /** Inject a WebSocket factory (tests). Defaults to the global `WebSocket`. */
  factory?: WsFactory;
  /** Ceiling on `connect()`, in ms. Default 15 000. */
  connectTimeoutMs?: number;
}

/** Build the relay's own `ws://`/`wss://` dial URL from a pairing offer's `relay` info. */
export function relayDialUrl(relay: { endpoint: string; useTls: boolean }): string {
  const scheme = relay.useTls ? "wss" : "ws";
  // Accept `http(s)://`/`ws(s)://`-prefixed endpoints (someone pasted a URL, not a bare host)
  // and normalize to the scheme `useTls` actually calls for — never concatenate two schemes.
  const host = relay.endpoint.replace(/^(?:https?|wss?):\/\//, "").replace(/\/+$/, "");
  return `${scheme}://${host}`;
}

/** Close codes with no close frame behind them: the socket never completed a WebSocket close. */
const NO_CLOSE_FRAME_CODES = new Set([1005, 1006, 1015]);

const RELAY_REFUSALS = new Map<number, RelayConnectReason>([
  [RELAY_CLOSE.DAEMON_OFFLINE.code, "daemon_offline"],
  [RELAY_CLOSE.DAEMON_UNRESPONSIVE.code, "daemon_unresponsive"],
  [RELAY_CLOSE.TOO_MANY_CLIENTS.code, "too_many_clients"],
  [RELAY_CLOSE.DAEMON_OUTDATED.code, "daemon_outdated"],
]);

/** Map a close that ended `connect()` to its reason. `paired`: the relay had answered already. */
function closeReason(code: number, paired: boolean): RelayConnectReason {
  const refusal = RELAY_REFUSALS.get(code);
  if (refusal) return refusal;
  // The `ready` box failed: the channel closed the socket with `channel_error`.
  if (paired && code === RELAY_CLOSE.CHANNEL_ERROR.code) return "wrong_key";
  if (!paired && NO_CLOSE_FRAME_CODES.has(code)) return "relay_unreachable";
  return "protocol_error";
}

function toBytes(data: unknown): Uint8Array | null {
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data))
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  return null;
}

type Phase = "idle" | "connecting" | "open" | "done";

/**
 * Create a `Transport` that connects to a relay endpoint and carries app traffic E2EE. `connect(url)`
 * dials `url` (the relay's own WebSocket address, NOT the daemon's — see {@link relayDialUrl}) and
 * resolves once the daemon's `ready` box has opened, or rejects with a {@link RelayConnectError}.
 */
export function createRelayTransport(opts: RelayTransportOptions): Transport {
  let ws: AnyWebSocket | null = null;
  let channel: Channel | null = null;
  let phase: Phase = "idle";
  // One id per `connect()` attempt: a socket or channel from an earlier attempt can still emit
  // events (a late close, a stale timer) after the transport was reused, and must never touch the
  // current attempt's state.
  let generation = 0;
  let abort: ((error: RelayConnectError) => void) | null = null;
  const sessionId = opts.sessionId ?? deriveRelaySessionId(opts.daemonPublicKey);
  const connectTimeoutMs = opts.connectTimeoutMs ?? RELAY_DEFAULTS.connectTimeoutMs;

  const self: Transport = {
    onMessage: null,
    onClose: null,
    onError: null,
    get isOpen(): boolean {
      return phase === "open" && ws !== null && ws.readyState === 1;
    },
    // Channel records are single binary frames, so the socket's queue is exactly the ciphertext
    // still waiting to leave — the right number to pace against.
    get bufferedAmount(): number | undefined {
      return ws?.bufferedAmount;
    },
    connect(url: string): Promise<void> {
      if (phase === "connecting" || phase === "open") {
        return Promise.reject(new Error("relay transport: already connecting or open"));
      }
      phase = "connecting";
      const gen = ++generation;
      return new Promise<void>((resolve, reject) => {
        let socket: AnyWebSocket;
        try {
          socket = opts.factory
            ? opts.factory(url)
            : (new WebSocket(url) as unknown as AnyWebSocket);
        } catch (err) {
          phase = "done";
          reject(new RelayConnectError("relay_unreachable", reasonOf(err)));
          return;
        }
        ws = socket;
        socket.binaryType = "arraybuffer";

        let paired = false;
        let frameHandler: ((frame: Uint8Array | string) => void) | null = null;
        let closeHandler: ((code?: number, reason?: string) => void) | null = null;

        const timer = setTimeout(() => fail(new RelayConnectError("timeout")), connectTimeoutMs);

        /**
         * Reject, tear the socket down, and tell the owner the transport is closed — like a failed
         * direct WebSocket does (`onerror` then `onclose`). `DaemonClient.connect()` sets
         * `connecting` before it awaits this promise and only `onClose` moves it on to `closed`;
         * without it a refused connect leaves the client stuck in `connecting` forever and the
         * reconnect loop never starts. Later events of this attempt are ignored (phase `done`).
         */
        const fail = (error: RelayConnectError): void => {
          if (gen !== generation || phase !== "connecting") return;
          phase = "done";
          abort = null;
          clearTimeout(timer);
          try {
            socket.close(1000, "");
          } catch {
            // already closing
          }
          ws = null;
          reject(error);
          self.onClose?.(1006, error.message);
        };
        abort = fail;

        const startChannel = (): void => {
          channel = createClientChannel({
            transport: {
              send: (bytes) => socket.send(bytes),
              onFrame: (h) => {
                frameHandler = h;
              },
              onClose: (h) => {
                closeHandler = h;
              },
              close: (code, reason) => socket.close(code, reason),
            },
            daemonPublicKey: opts.daemonPublicKey,
            events: {
              onReady: () => {
                if (gen !== generation || phase !== "connecting") return;
                phase = "open";
                abort = null;
                clearTimeout(timer);
                resolve();
              },
              onText: (text) => {
                if (gen === generation && phase === "open") self.onMessage?.(text);
              },
              onBinary: (bytes) => {
                if (gen === generation && phase === "open")
                  self.onMessage?.(bytes.buffer as ArrayBuffer);
              },
              onError: (cause) => {
                if (gen === generation && phase === "open") self.onError?.(cause);
              },
              onClose: (code, reason) => {
                if (gen !== generation) return;
                if (phase === "connecting") {
                  fail(new RelayConnectError(closeReason(code ?? 1006, true), reason));
                } else if (phase === "open") {
                  phase = "done";
                  self.onClose?.(code ?? 1006, reason ?? "");
                }
              },
            },
          });
        };

        socket.onopen = () => {
          if (gen !== generation || phase !== "connecting") return;
          socket.send(JSON.stringify({ type: "relay_client_connect", v: 2, sessionId }));
        };
        socket.onmessage = (ev) => {
          if (gen !== generation) return;
          if (phase === "connecting" && !paired) {
            const frame = typeof ev.data === "string" ? parseRelayFrame(ev.data) : null;
            if (frame?.type === "relay_paired") {
              paired = true;
              startChannel();
            } else if (frame === null || frame.type !== "relay_registered") {
              fail(new RelayConnectError("protocol_error", "unexpected frame before relay_paired"));
            }
            return;
          }
          if (phase === "done") return;
          const bytes = typeof ev.data === "string" ? ev.data : toBytes(ev.data);
          if (bytes !== null) frameHandler?.(bytes);
        };
        socket.onerror = (ev) => {
          if (gen === generation && phase === "connecting" && !paired) {
            fail(new RelayConnectError("relay_unreachable", reasonOf(ev)));
          }
          // After pairing a socket error is followed by a close, which the channel reports.
        };
        socket.onclose = (ev) => {
          if (gen !== generation) return;
          const reason = reasonString(ev.reason);
          if (phase === "connecting" && !paired) {
            fail(new RelayConnectError(closeReason(ev.code, false), reason));
          } else if (closeHandler) {
            closeHandler(ev.code, reason);
          } else if (phase === "open") {
            phase = "done";
            self.onClose?.(ev.code, reason);
          }
        };
      });
    },
    sendText(data: string): void {
      if (phase !== "open" || !channel) {
        throw new Error("relay transport: cannot send before the E2EE handshake completes");
      }
      channel.send(data);
    },
    sendBinary(data: Uint8Array): void {
      if (phase !== "open" || !channel) {
        throw new Error("relay transport: cannot send before the E2EE handshake completes");
      }
      channel.sendBinary(data);
    },
    close(code = 1000, reason = ""): void {
      if (phase === "connecting") {
        abort?.(new RelayConnectError("protocol_error", "closed before the connection opened"));
        return;
      }
      if (phase !== "open") return;
      phase = "done";
      const open = channel;
      channel = null;
      open?.close(code, reason);
      ws = null;
      self.onClose?.(code, reason);
    },
  };
  return self;
}

function reasonOf(err: unknown): string | undefined {
  if (err instanceof Error) return err.message;
  const message = (err as { message?: unknown } | null)?.message;
  return typeof message === "string" && message !== "" ? message : undefined;
}
