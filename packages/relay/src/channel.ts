/**
 * Relay encrypted channel, protocol 2 (architecture/relay-protocol.md § 4). One channel per socket,
 * binary frames only. NaCl box with a nonce of salt (15) ‖ direction (1) ‖ counter (8, big-endian).
 * The daemon draws the salt, so a replayed `hello` cannot make it reuse a key and nonce. Counters
 * are never sent. Any failure reports `onError`, closes the transport with 4200 `channel_error`
 * and delivers nothing from the offending frame.
 *
 * Browser-safe: only `tweetnacl` and typed arrays.
 */
import nacl from "tweetnacl";
import { RELAY_CLOSE } from "./control.js";

/** Channel format version: the leading byte of `hello` and `ready`. */
export const CHANNEL_VERSION = 0x01;
/** Daemon-chosen salt length in bytes. */
export const CHANNEL_SALT_LENGTH = 15;
/** Record kinds (the first plaintext byte inside a box). */
export const RECORD_KIND = { READY: 0x00, TEXT: 0x01, BINARY: 0x02 } as const;
/** Nonce direction bytes. */
export const CHANNEL_DIRECTION = { CLIENT_TO_DAEMON: 0x01, DAEMON_TO_CLIENT: 0x02 } as const;

const KEY_LENGTH = 32;
const NONCE_LENGTH = 24;
/** Smallest valid box: a 1-byte record plus the 16-byte Poly1305 tag. */
const MIN_BOX_LENGTH = 1 + nacl.box.overheadLength;
const COUNTER_END = 1n << 64n;

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

/** The socket a channel rides on: bytes, not strings. */
export interface Transport {
  /** Send one binary WebSocket frame. */
  send(bytes: Uint8Array): void;
  /** A string is a text frame, which is a protocol error. */
  onFrame(handler: (frame: Uint8Array | string) => void): void;
  onClose(handler: (code?: number, reason?: string) => void): void;
  close(code?: number, reason?: string): void;
}

export interface ChannelEvents {
  onText(text: string): void;
  onBinary(bytes: Uint8Array): void;
  /** Daemon: `hello` accepted and `ready` sent. Client: the `ready` box opened. */
  onReady?(): void;
  onClose?(code?: number, reason?: string): void;
  onError?(cause: Error): void;
}

export interface Channel {
  /** Send one text message. Throws before the channel is open or after it closed. */
  send(text: string): void;
  /** Send one binary message. Throws before the channel is open or after it closed. */
  sendBinary(bytes: Uint8Array): void;
  /** Close the transport (default code 1000). */
  close(code?: number, reason?: string): void;
}

/** Test seams shared by both sides. */
interface CounterOptions {
  /** First counter used and expected in each direction. Default 0n. */
  counterStart?: bigint;
  /** A counter at or above this value is never used; the channel closes instead. Default 2^64. */
  counterLimit?: bigint;
}

export interface DaemonChannelOptions extends CounterOptions {
  transport: Transport;
  daemonKeypair: { publicKey: Uint8Array; secretKey: Uint8Array };
  events: ChannelEvents;
  /** Source of the salt. Default `nacl.randomBytes`. */
  randomBytes?: (length: number) => Uint8Array;
}

export interface ClientChannelOptions extends CounterOptions {
  transport: Transport;
  daemonPublicKey: Uint8Array;
  events: ChannelEvents;
  /** Client key pair. Default: a fresh `nacl.box.keyPair()`. */
  keyPair?: { publicKey: Uint8Array; secretKey: Uint8Array };
}

/** Build the 24-byte nonce. */
export function channelNonce(salt: Uint8Array, direction: number, counter: bigint): Uint8Array {
  const nonce = new Uint8Array(NONCE_LENGTH);
  nonce.set(salt, 0);
  nonce[CHANNEL_SALT_LENGTH] = direction;
  new DataView(nonce.buffer).setBigUint64(CHANNEL_SALT_LENGTH + 1, counter, false);
  return nonce;
}

function record(kind: number, payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(1 + payload.length);
  out[0] = kind;
  out.set(payload, 1);
  return out;
}

/** State and framing shared by both roles. */
class Core implements Channel {
  protected key: Uint8Array | null = null;
  protected salt: Uint8Array | null = null;
  protected open = false;
  protected closed = false;
  private sent: bigint;
  private received: bigint;
  private readonly limit: bigint;

  constructor(
    protected readonly transport: Transport,
    protected readonly events: ChannelEvents,
    private readonly sendDirection: number,
    private readonly receiveDirection: number,
    options: CounterOptions,
  ) {
    this.sent = options.counterStart ?? 0n;
    this.received = options.counterStart ?? 0n;
    this.limit = options.counterLimit ?? COUNTER_END;
    transport.onClose((code, reason) => this.handleTransportClose(code, reason));
    transport.onFrame((frame) => this.handleFrame(frame));
  }

  send(text: string): void {
    this.sealAndSend(RECORD_KIND.TEXT, encoder.encode(text));
  }

  sendBinary(bytes: Uint8Array): void {
    this.sealAndSend(RECORD_KIND.BINARY, bytes);
  }

  close(code = 1000, reason = ""): void {
    if (this.closed) return;
    this.closed = true;
    this.transport.close(code, reason);
    this.events.onClose?.(code, reason);
  }

  protected handleFrame(_frame: Uint8Array | string): void {}

  /** Report `cause`, close with `channel_error`, deliver nothing. */
  protected fail(cause: string): void {
    if (this.closed) return;
    this.closed = true;
    this.events.onError?.(new Error(cause));
    this.transport.close(RELAY_CLOSE.CHANNEL_ERROR.code, RELAY_CLOSE.CHANNEL_ERROR.reason);
    this.events.onClose?.(RELAY_CLOSE.CHANNEL_ERROR.code, RELAY_CLOSE.CHANNEL_ERROR.reason);
  }

  /** Seal with the next send counter. Closes instead of wrapping. */
  protected seal(plain: Uint8Array): Uint8Array {
    if (!this.key || !this.salt) throw new Error("channel not open");
    if (this.sent >= this.limit) {
      this.fail("counter limit reached");
      throw new Error("channel counter limit reached");
    }
    const nonce = channelNonce(this.salt, this.sendDirection, this.sent);
    const box = nacl.box.after(plain, nonce, this.key);
    this.sent += 1n;
    return box;
  }

  /** Open with the next expected counter; null (after failing) when it does not open. */
  protected unseal(box: Uint8Array): Uint8Array | null {
    if (!this.key || !this.salt) return null;
    if (this.received >= this.limit) {
      this.fail("counter limit reached");
      return null;
    }
    if (box.length < MIN_BOX_LENGTH) {
      this.fail("box too short");
      return null;
    }
    const nonce = channelNonce(this.salt, this.receiveDirection, this.received);
    const plain = nacl.box.open.after(box, nonce, this.key);
    if (!plain || plain.length < 1) {
      this.fail("box did not open");
      return null;
    }
    this.received += 1n;
    return plain;
  }

  /** Deliver a text or binary record. Returns false (after failing) for any other kind. */
  protected deliver(plain: Uint8Array): boolean {
    const kind = plain[0];
    const payload = plain.subarray(1);
    if (kind === RECORD_KIND.TEXT) {
      let text: string;
      try {
        text = decoder.decode(payload);
      } catch {
        this.fail("text record is not UTF-8");
        return false;
      }
      this.events.onText(text);
      return true;
    }
    if (kind === RECORD_KIND.BINARY) {
      this.events.onBinary(payload.slice());
      return true;
    }
    this.fail(kind === RECORD_KIND.READY ? "unexpected ready record" : "unknown record kind");
    return false;
  }

  private sealAndSend(kind: number, payload: Uint8Array): void {
    if (this.closed) throw new Error("channel closed");
    if (!this.open) throw new Error("channel not open");
    this.transport.send(this.seal(record(kind, payload)));
  }

  private handleTransportClose(code?: number, reason?: string): void {
    if (this.closed) return;
    this.closed = true;
    this.events.onClose?.(code, reason);
  }
}

class DaemonChannel extends Core {
  private helloSeen = false;

  constructor(private readonly o: DaemonChannelOptions) {
    super(
      o.transport,
      o.events,
      CHANNEL_DIRECTION.DAEMON_TO_CLIENT,
      CHANNEL_DIRECTION.CLIENT_TO_DAEMON,
      o,
    );
  }

  protected override handleFrame(frame: Uint8Array | string): void {
    if (this.closed) return;
    if (typeof frame === "string") return this.fail("text frame on channel");
    if (!this.helloSeen) return this.handleHello(frame);
    const plain = this.unseal(frame);
    if (plain) this.deliver(plain);
  }

  private handleHello(frame: Uint8Array): void {
    if (frame.length !== 1 + KEY_LENGTH || frame[0] !== CHANNEL_VERSION) {
      return this.fail("malformed hello");
    }
    this.helloSeen = true;
    this.key = nacl.box.before(frame.slice(1), this.o.daemonKeypair.secretKey);
    this.salt = (this.o.randomBytes ?? nacl.randomBytes)(CHANNEL_SALT_LENGTH).slice();
    const box = this.seal(new Uint8Array([RECORD_KIND.READY]));
    const ready = new Uint8Array(1 + CHANNEL_SALT_LENGTH + box.length);
    ready[0] = CHANNEL_VERSION;
    ready.set(this.salt, 1);
    ready.set(box, 1 + CHANNEL_SALT_LENGTH);
    this.open = true;
    this.transport.send(ready);
    this.events.onReady?.();
  }
}

class ClientChannel extends Core {
  private readyOpened = false;
  private readonly secretKey: Uint8Array;

  constructor(o: ClientChannelOptions) {
    super(
      o.transport,
      o.events,
      CHANNEL_DIRECTION.CLIENT_TO_DAEMON,
      CHANNEL_DIRECTION.DAEMON_TO_CLIENT,
      o,
    );
    const keyPair = o.keyPair ?? nacl.box.keyPair();
    this.secretKey = keyPair.secretKey;
    this.key = nacl.box.before(o.daemonPublicKey, this.secretKey);
    const hello = new Uint8Array(1 + KEY_LENGTH);
    hello[0] = CHANNEL_VERSION;
    hello.set(keyPair.publicKey, 1);
    o.transport.send(hello);
  }

  protected override handleFrame(frame: Uint8Array | string): void {
    if (this.closed) return;
    if (typeof frame === "string") return this.fail("text frame on channel");
    if (!this.readyOpened) return this.handleReady(frame);
    const plain = this.unseal(frame);
    if (plain) this.deliver(plain);
  }

  private handleReady(frame: Uint8Array): void {
    if (frame.length < 1 + CHANNEL_SALT_LENGTH + MIN_BOX_LENGTH || frame[0] !== CHANNEL_VERSION) {
      return this.fail("malformed ready");
    }
    this.salt = frame.slice(1, 1 + CHANNEL_SALT_LENGTH);
    const plain = this.unseal(frame.subarray(1 + CHANNEL_SALT_LENGTH));
    if (!plain) return;
    if (plain.length !== 1 || plain[0] !== RECORD_KIND.READY) {
      return this.fail("first box is not a ready record");
    }
    this.readyOpened = true;
    this.open = true;
    this.events.onReady?.();
  }
}

/** Daemon side: waits for `hello`, answers `ready`, then exchanges records. */
export function createDaemonChannel(options: DaemonChannelOptions): Channel {
  return new DaemonChannel(options);
}

/** Client side: sends `hello` at once; sends nothing else until the `ready` box has opened. */
export function createClientChannel(options: ClientChannelOptions): Channel {
  return new ClientChannel(options);
}
