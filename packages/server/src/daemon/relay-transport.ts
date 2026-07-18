/**
 * Daemon-side outbound relay transport (architecture/relay-e2ee.md § Behavior — Connection setup,
 * § TLS; architecture/daemon-bootstrap.md § Behavior — `connectRelay`).
 *
 * The daemon dials OUTBOUND to a relay server (so no inbound port needs to be opened) and registers
 * a session id so the relay can pair an incoming client connection with this daemon. Once
 * connected, all application traffic on the socket is E2EE via `createDaemonChannel`
 * (`@av-pi-studio/relay`) — the daemon refuses to process ANY app message until the client's
 * `e2ee_hello`/`e2ee_ready` handshake completes.
 *
 * TODO(verify): the exact registration frame format is unresolved upstream
 * (architecture/relay-e2ee.md § TODO(verify) — "Relay server routing/session-id assignment
 * protocol details"). This implementation registers with `{ type: "relay_register", sessionId }`
 * immediately after the socket opens; the client transport (task-003) and Cloudflare adapter
 * (task-004) built in this sprint agree on this same frame.
 */
import { randomUUID } from "node:crypto";
import { WebSocket } from "ws";

import { createDaemonChannel, type EncryptedChannel, type Transport } from "@av-pi-studio/relay";

/** Mirrors `daemon.relay` in `daemon-config.ts` / architecture/config.md. */
export interface RelayConfig {
  enabled: boolean;
  endpoint?: string;
  publicEndpoint?: string;
  useTls: boolean;
  publicUseTls: boolean;
}

export interface DaemonKeypair {
  publicKey: Uint8Array;
  secretKey: Uint8Array;
}

export interface RelayTransportEvents {
  /** Fired with a decrypted app message once a client's E2EE handshake completes; `reply` sends an encrypted response back on the same channel. */
  onMessage?: (plaintext: string, reply: (message: string) => void) => void;
  /** Fired once per successful (re)connection, with the session id just registered. */
  onSessionStart?: (sessionId: string) => void;
  /** Fired when a relay drop triggers a reconnect, with the NEW session id about to be registered. */
  onReconnect?: (sessionId: string) => void;
  onError?: (error: unknown) => void;
}

export interface RelayTransportHandle {
  readonly sessionId: string;
  /** Tear down the relay transport: stops reconnecting and closes the current socket/channel. */
  close(): void;
}

function relayUrl(config: RelayConfig): string {
  if (!config.endpoint) {
    throw new Error("relay-transport: config.daemon.relay.endpoint is required when relay.enabled");
  }
  const scheme = config.useTls ? "wss" : "ws";
  const host = config.endpoint.replace(/^wss?:\/\//, "").replace(/\/+$/, "");
  return `${scheme}://${host}`;
}

/** Wrap a `ws` `WebSocket` as the relay package's transport-agnostic `Transport`. */
function wrapSocket(socket: WebSocket): Transport {
  const messageHandlers: Array<(data: string) => void> = [];
  const closeHandlers: Array<(reason?: string) => void> = [];
  socket.on("message", (data: Buffer | ArrayBuffer | Buffer[], isBinary: boolean) => {
    if (isBinary) return; // the relay channel protocol is text-frame only
    const text = Array.isArray(data)
      ? Buffer.concat(data).toString("utf8")
      : Buffer.isBuffer(data)
        ? data.toString("utf8")
        : Buffer.from(data as ArrayBuffer).toString("utf8");
    for (const h of messageHandlers) h(text);
  });
  socket.on("close", (code: number, reasonBuf: Buffer) => {
    const reason = reasonBuf?.length ? reasonBuf.toString("utf8") : `code ${code}`;
    for (const h of closeHandlers) h(reason);
  });
  return {
    send: (data) => {
      if (socket.readyState === WebSocket.OPEN) socket.send(data);
    },
    onMessage: (h) => messageHandlers.push(h),
    onClose: (h) => closeHandlers.push(h),
    close: () => socket.close(),
  };
}

/**
 * Dial outbound to the relay, register a fresh session id, and wire an E2EE `createDaemonChannel`
 * over the resulting socket. On drop, reconnects with a BRAND NEW session id (and therefore a
 * fresh ECDH derivation once a client re-attaches) — architecture/relay-e2ee.md § Error Handling:
 * "Relay restarts / drops → client/daemon reconnect; new session → new keys".
 */
export function connectRelay(
  keypair: DaemonKeypair,
  config: RelayConfig,
  events: RelayTransportEvents = {},
): RelayTransportHandle {
  let closed = false;
  let currentSocket: WebSocket | null = null;
  let currentChannel: EncryptedChannel | null = null;
  let sessionId = randomUUID();

  const dial = (): void => {
    if (closed) return;
    const socket = new WebSocket(relayUrl(config));
    currentSocket = socket;

    socket.on("open", () => {
      if (closed) return;
      socket.send(JSON.stringify({ type: "relay_register", sessionId }));

      const channel = createDaemonChannel({
        transport: wrapSocket(socket),
        attachment: { sessionId },
        daemonKeypair: keypair,
        events: {
          onMessage: (plaintext) => events.onMessage?.(plaintext, (message) => channel.send(message)),
          onAuthError: (err) => events.onError?.(err),
        },
      });
      currentChannel = channel;
      events.onSessionStart?.(sessionId);
    });

    socket.on("close", () => {
      currentSocket = null;
      currentChannel = null;
      if (closed) return;
      sessionId = randomUUID();
      events.onReconnect?.(sessionId);
      dial();
    });

    socket.on("error", (err) => {
      events.onError?.(err);
    });
  };

  dial();

  return {
    get sessionId() {
      return sessionId;
    },
    close() {
      closed = true;
      currentChannel?.close();
      currentSocket?.close();
    },
  };
}
