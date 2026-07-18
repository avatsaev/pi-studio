/**
 * Relay encrypted channel primitives (architecture/relay-e2ee.md § Channel API, § Handshake
 * frames, § Behavior). `createClientChannel` and `createDaemonChannel` expose an IDENTICAL API so
 * the daemon and client share the same E2EE code path over a relay-provided transport.
 *
 * Handshake:
 *   client → daemon: e2ee_hello { ephemeralPublicKey }   (client's FRESH ephemeral Curve25519 key)
 *   daemon → client: e2ee_ready                          (handshake acknowledgement)
 *   both:            sharedKey = ECDH(localSecret, remotePublic)   (Curve25519 box.before)
 *
 * Per-message wire format (after handshake):
 *   frame = base64( [24-byte random nonce] ++ box(plaintext, nonce, sharedKey) )   // XSalsa20-Poly1305
 *   receive → split nonce/ciphertext → box_open → reject (drop, never throw to the app) on auth failure.
 *
 * The daemon secret never leaves the daemon; the client keypair is ephemeral per connection, so
 * there is no persistent client-side secret to steal. Session keys are fresh per session, so
 * ciphertext cannot replay across sessions — but replay protection WITHIN a live session is not
 * implemented (random nonces, no counter) per architecture/relay-e2ee.md § Behavior TODO(verify).
 */
import nacl from "tweetnacl";
import { decodeBase64, encodeBase64 } from "./base64.js";

/** Which side of the handshake a channel plays. */
export type ConnectionRole = "client" | "daemon";

/** Minimal transport a channel rides on: send/receive UTF-8 text frames over the relay link. */
export interface Transport {
  send(data: string): void;
  onMessage(handler: (data: string) => void): void;
  onClose(handler: (reason?: string) => void): void;
  close(): void;
}

/** Events an `EncryptedChannel` emits to its owner. */
export interface EncryptedChannelEvents {
  /** Fired once the E2EE handshake completes and app messages may flow. */
  onReady?: () => void;
  /** Fired for each successfully decrypted+authenticated app message. */
  onMessage?: (plaintext: string) => void;
  /** Fired when the underlying transport closes. */
  onClose?: (reason?: string) => void;
  /** Fired when a received frame fails authentication (tampered/corrupt) — the message is dropped. */
  onAuthError?: (error: unknown) => void;
}

/** Opaque attachment describing which relay session a channel is bound to. */
export interface RelaySessionAttachment {
  sessionId: string;
}

export interface EncryptedChannel {
  readonly role: ConnectionRole;
  readonly attachment: RelaySessionAttachment;
  /** True once the handshake has completed and `send` will actually transmit. */
  readonly ready: boolean;
  /** Encrypt + send an application message. Throws if called before the handshake completes. */
  send(plaintext: string): void;
  close(): void;
}

interface HandshakeHelloFrame {
  type: "e2ee_hello";
  ephemeralPublicKey: string;
}
interface HandshakeReadyFrame {
  type: "e2ee_ready";
}
interface AppFrame {
  type: "e2ee_app";
  frame: string; // base64(nonce ++ ciphertext)
}
type WireFrame = HandshakeHelloFrame | HandshakeReadyFrame | AppFrame;

function parseFrame(data: string): WireFrame | null {
  try {
    const parsed = JSON.parse(data) as { type?: unknown };
    if (!parsed || typeof parsed.type !== "string") return null;
    return parsed as WireFrame;
  } catch {
    return null;
  }
}

const NONCE_LENGTH = 24; // XSalsa20-Poly1305 nonce size (nacl.box.nonceLength)

/** Encrypt `plaintext` under `sharedKey`, producing the wire frame `base64(nonce ++ ciphertext)`. */
function seal(plaintext: string, sharedKey: Uint8Array): string {
  const nonce = nacl.randomBytes(NONCE_LENGTH);
  const message = new TextEncoder().encode(plaintext);
  const ciphertext = nacl.box.after(message, nonce, sharedKey);
  const combined = new Uint8Array(nonce.length + ciphertext.length);
  combined.set(nonce, 0);
  combined.set(ciphertext, nonce.length);
  return encodeBase64(combined);
}

/** Decrypt a `base64(nonce ++ ciphertext)` wire frame under `sharedKey`, or return `null` on auth failure. */
function open(frame: string, sharedKey: Uint8Array): string | null {
  let combined: Uint8Array;
  try {
    combined = decodeBase64(frame);
  } catch {
    return null;
  }
  if (combined.length < NONCE_LENGTH) return null;
  const nonce = combined.slice(0, NONCE_LENGTH);
  const ciphertext = combined.slice(NONCE_LENGTH);
  const opened = nacl.box.open.after(ciphertext, nonce, sharedKey);
  return opened ? new TextDecoder().decode(opened) : null;
}

/** Shared app-frame plumbing once both sides agree on `sharedKey` — identical for client/daemon. */
function wireAppMessages(
  role: ConnectionRole,
  attachment: RelaySessionAttachment,
  transport: Transport,
  events: EncryptedChannelEvents,
  getSharedKey: () => Uint8Array | null,
  isReady: () => boolean,
): Pick<EncryptedChannel, "send" | "close"> & { handleAppFrame: (frame: AppFrame) => void } {
  let closed = false;
  transport.onClose((reason) => {
    closed = true;
    events.onClose?.(reason);
  });
  return {
    handleAppFrame(frame) {
      if (closed) return;
      const sharedKey = getSharedKey();
      if (!isReady() || !sharedKey) return; // refuse ANY app message before handshake completes
      const plaintext = open(frame.frame, sharedKey);
      if (plaintext === null) {
        events.onAuthError?.(new Error(`relay ${role} channel: message failed authentication`));
        return;
      }
      events.onMessage?.(plaintext);
    },
    send(plaintext: string) {
      if (closed) throw new Error(`relay ${role} channel: cannot send after close()`);
      const sharedKey = getSharedKey();
      if (!isReady() || !sharedKey) {
        throw new Error(`relay ${role} channel: cannot send before the E2EE handshake completes`);
      }
      transport.send(JSON.stringify({ type: "e2ee_app", frame: seal(plaintext, sharedKey) } satisfies AppFrame));
    },
    close() {
      if (closed) return;
      closed = true;
      transport.close();
    },
  };
}

export interface CreateDaemonChannelOptions {
  transport: Transport;
  attachment: RelaySessionAttachment;
  /**
   * The daemon's persistent Curve25519 keypair (architecture/relay-e2ee.md § Data & Persistence —
   * `daemon-keypair.json`). Used directly for ECDH: the client derives its shared key from this
   * same public key (via the pairing offer) before the handshake even starts, so the daemon MUST
   * use its persistent secret key here, not a per-connection ephemeral one. The secret never
   * leaves the daemon process.
   */
  daemonKeypair: { publicKey: Uint8Array; secretKey: Uint8Array };
  events?: EncryptedChannelEvents;
}

/**
 * Daemon side of an encrypted relay channel. The daemon waits for the client's `e2ee_hello`,
 * derives the shared key from its own persistent secret key + the client's fresh ephemeral public
 * key, replies with `e2ee_ready`, and only then becomes `ready` (refusing all app traffic before
 * that — architecture/relay-e2ee.md § Error Handling).
 */
export function createDaemonChannel(opts: CreateDaemonChannelOptions): EncryptedChannel {
  const { transport, attachment, daemonKeypair } = opts;
  const events = opts.events ?? {};

  let sharedKey: Uint8Array | null = null;
  let ready = false;

  const plumbing = wireAppMessages(
    "daemon",
    attachment,
    transport,
    events,
    () => sharedKey,
    () => ready,
  );

  transport.onMessage((data) => {
    const frame = parseFrame(data);
    if (!frame) return; // ignore anything the relay/peer sends that isn't a recognized frame

    if (frame.type === "e2ee_hello") {
      if (ready) return; // handshake already completed for this channel; ignore replays
      let remotePublicKey: Uint8Array;
      try {
        remotePublicKey = decodeBase64(frame.ephemeralPublicKey);
      } catch {
        return;
      }
      sharedKey = nacl.box.before(remotePublicKey, daemonKeypair.secretKey);
      ready = true;
      transport.send(JSON.stringify({ type: "e2ee_ready" } satisfies HandshakeReadyFrame));
      events.onReady?.();
      return;
    }

    if (frame.type === "e2ee_app") {
      plumbing.handleAppFrame(frame);
    }
    // `e2ee_ready` is never sent to a daemon channel; ignore if it arrives.
  });

  return {
    role: "daemon",
    attachment,
    get ready() {
      return ready;
    },
    send: plumbing.send,
    close: plumbing.close,
  };
}

export interface CreateClientChannelOptions {
  transport: Transport;
  attachment: RelaySessionAttachment;
  /** The daemon's persistent public key, obtained out-of-band via the pairing offer (task-003). */
  daemonPublicKey: Uint8Array;
  events?: EncryptedChannelEvents;
}

/**
 * Client side of an encrypted relay channel. The client already knows the daemon's persistent
 * public key (from the pairing offer), so it generates a FRESH ephemeral keypair, derives the
 * shared key immediately, and sends `e2ee_hello`. It becomes `ready` only after the daemon
 * confirms with `e2ee_ready` — mirroring the daemon's "no app traffic before handshake" gating on
 * the client side too, for a genuinely symmetric API.
 */
export function createClientChannel(opts: CreateClientChannelOptions): EncryptedChannel {
  const { transport, attachment, daemonPublicKey } = opts;
  const events = opts.events ?? {};
  const ephemeral = nacl.box.keyPair();
  const sharedKey = nacl.box.before(daemonPublicKey, ephemeral.secretKey);

  let ready = false;

  const plumbing = wireAppMessages(
    "client",
    attachment,
    transport,
    events,
    () => sharedKey,
    () => ready,
  );

  transport.onMessage((data) => {
    const frame = parseFrame(data);
    if (!frame) return;

    if (frame.type === "e2ee_ready") {
      if (ready) return;
      ready = true;
      events.onReady?.();
      return;
    }

    if (frame.type === "e2ee_app") {
      plumbing.handleAppFrame(frame);
    }
    // `e2ee_hello` is never sent to a client channel; ignore if it arrives.
  });

  transport.send(
    JSON.stringify({
      type: "e2ee_hello",
      ephemeralPublicKey: encodeBase64(ephemeral.publicKey),
    } satisfies HandshakeHelloFrame),
  );

  return {
    role: "client",
    attachment,
    get ready() {
      return ready;
    },
    send: plumbing.send,
    close: plumbing.close,
  };
}
