/**
 * Daemon-side outbound relay transport (architecture/relay-e2ee.md § Behavior — Connection setup,
 * § TLS, § Pairing; architecture/daemon-bootstrap.md § Behavior — `connectRelay`).
 *
 * The daemon dials OUTBOUND to a relay server (so no inbound port needs to be opened) and registers
 * a session id so the relay can pair an incoming client connection with this daemon. Once
 * connected, all application traffic on the socket is E2EE via `createDaemonChannel`
 * (`@av-pi-studio/relay`) — the daemon refuses to process ANY app message until the client's
 * `e2ee_hello`/`e2ee_ready` handshake completes.
 *
 * The session id is `deriveRelaySessionId(keypair.publicKey)` — deterministic, not random — so a
 * pairing URL printed once keeps working across relay reconnects. Earlier this used a fresh
 * `randomUUID()` per connect AND per reconnect, which meant any pairing link went stale the moment
 * the relay connection dropped and reconnected (the daemon would register under a session id no
 * printed link referenced). Deriving from the public key — which the pairing link already carries
 * and which the spec already treats as the trust anchor (relay-e2ee.md § Pairing) — costs nothing
 * in secrecy and keeps the same session id for the life of the daemon's keypair.
 *
 * TODO(verify): the exact registration frame format is unresolved upstream
 * (architecture/relay-e2ee.md § TODO(verify) — "Relay server routing/session-id assignment
 * protocol details"). This implementation registers with `{ type: "relay_register", sessionId }`
 * immediately after the socket opens; the client transport (task-003) and Cloudflare adapter
 * (task-004) built in this sprint agree on this same frame.
 */
import { WebSocket } from "ws";

import {
  createDaemonChannel,
  deriveRelaySessionId,
  type EncryptedChannel,
  type Transport,
} from "@av-pi-studio/relay";

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
  /** Fired with a decrypted TEXT app message once a client's E2EE handshake completes; `reply` sends an encrypted text response back on the same channel. */
  onMessage?: (plaintext: string, reply: (message: string) => void) => void;
  /**
   * Fired with a decrypted BINARY app message (terminal I/O, file-transfer chunks) once a
   * client's E2EE handshake completes; `replyBinary` sends an encrypted binary response back on
   * the same channel. Mirrors `onMessage`/`reply` exactly, just for the binary sibling wire frame
   * (`e2ee_bin` vs `e2ee_app` — see `@av-pi-studio/relay`'s `channel.ts`).
   */
  onBinaryMessage?: (bytes: Uint8Array, replyBinary: (bytes: Uint8Array) => void) => void;
  /** Fired once per successful (re)connection, with the session id just registered. */
  onSessionStart?: (sessionId: string) => void;
  /** Fired when a relay drop triggers a reconnect, with the NEW session id about to be registered. */
  onReconnect?: (sessionId: string) => void;
  /**
   * Fired every time the E2EE handshake (re)completes on the current relay socket — not just
   * once per socket connection. The relay multiplexes one deterministic session id across
   * however many client sockets attach over the daemon's lifetime (browser reload, second tab,
   * plain reconnect); `createDaemonChannel` now re-arms on each fresh `e2ee_hello` instead of
   * ignoring it, so a NEW peer taking over an already-`ready` channel fires this again. Consumers
   * should treat it as "forget any app-level session state tied to the previous peer" — the next
   * app frame is a new peer's `hello`, not a continuation of the old peer's session.
   */
  onHandshake?: () => void;
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
  // Accept `http(s)://`/`ws(s)://`-prefixed endpoints (someone pasted a URL, not a bare host)
  // and normalize to the scheme `useTls` actually calls for — never concatenate two schemes.
  const host = config.endpoint.replace(/^(?:https?|wss?):\/\//, "").replace(/\/+$/, "");
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
 * Dial outbound to the relay, registering the deterministic session id derived from the daemon's
 * own public key (`deriveRelaySessionId`) — the SAME id on every (re)connect, so a pairing URL
 * printed once keeps working across relay drops/restarts. This does not weaken
 * architecture/relay-e2ee.md § Error Handling's "new session → new keys" guarantee: the rendezvous
 * session id is just a routing label the relay uses to pair sockets, never a key input — the
 * client's `createClientChannel` still generates a FRESH ephemeral Curve25519 keypair on every
 * connection, so every reconnect still derives an independent ECDH shared key even though the
 * session id it registers under is unchanged.
 */
export function connectRelay(
  keypair: DaemonKeypair,
  config: RelayConfig,
  events: RelayTransportEvents = {},
): RelayTransportHandle {
  let closed = false;
  let currentSocket: WebSocket | null = null;
  let currentChannel: EncryptedChannel | null = null;
  const sessionId = deriveRelaySessionId(keypair.publicKey);

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
          onBinaryMessage: (bytes) => events.onBinaryMessage?.(bytes, (reply) => channel.sendBinary(reply)),
          onReady: () => events.onHandshake?.(),
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
