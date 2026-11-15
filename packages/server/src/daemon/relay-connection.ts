/**
 * One relay data socket per client connection (architecture/relay-protocol.md § Behavior — Daemon
 * (data socket), § 2, § Error handling; features/relay-multi-client.md § Public contract 2).
 *
 * Given a `connectionId` from the relay's `relay_dial`, the daemon dials a data socket, sends
 * `relay_daemon_attach`, waits for `relay_paired`, then runs the channel's daemon side
 * (`createDaemonChannel`) over the socket and exposes it as a `RelayConnection` that behaves like a
 * direct socket: text, binary, queued bytes, open state and close with a code. The socket is a real
 * `ws` socket, so `bufferedAmount` is real and download pacing works on the relay.
 *
 * Sessions and `hello` handling live above this module; it imports no `Session` or registry code.
 */
import { WebSocket } from "ws";

import {
  createDaemonChannel,
  encodeControlFrame,
  parseRelayFrame,
  RELAY_CLOSE,
  RELAY_DEFAULTS,
  type Channel,
  type Transport,
} from "@av-pi-studio/relay";

import type { Logger } from "../logging/logger.js";
import type { DaemonKeypair } from "./relay-transport.js";

/** Timers and sizes tests may shorten; `RELAY_DEFAULTS` supplies every value not given. */
export interface RelayConnectionLimits {
  /** Largest accepted WebSocket frame. */
  maxFrameBytes?: number;
  /** Dial plus pairing: the socket is closed when `relay_paired` has not arrived in time. */
  attachTimeoutMs?: number;
  /** A paired socket that has not received a valid channel `hello` is closed. */
  keyExchangeTimeoutMs?: number;
  /** No frame and no ping from the relay for this long: the socket is dead. */
  silenceTimeoutMs?: number;
}

export interface OpenRelayConnectionOptions {
  /** Relay WebSocket URL (`ws://host:port` or `wss://…`). */
  url: string;
  sessionId: string;
  connectionId: string;
  keypair: DaemonKeypair;
  limits?: RelayConnectionLimits;
  logger: Logger;
}

/** A client connection routed through the relay; mirrors a direct socket. */
export interface RelayConnection {
  readonly connectionId: string;
  /** The data socket's queued bytes. */
  readonly bufferedAmount: number;
  /** Channel ready and socket open. */
  readonly isOpen: boolean;
  /** Send one text message; dropped silently when the connection is not open. */
  sendText(text: string): void;
  /** Send one binary message; dropped silently when the connection is not open. */
  sendBinary(bytes: Uint8Array): void;
  /** Close the data socket with `code`; the relay forwards it to the client. */
  close(code?: number, reason?: string): void;
  onText(handler: (text: string) => void): void;
  onBinary(handler: (bytes: Uint8Array) => void): void;
  /** Fires once, with the code the socket closed with. */
  onClose(handler: (code: number, reason: string) => void): void;
}

const decoder = new TextDecoder();

type RawData = Buffer | ArrayBuffer | Buffer[];

function toBytes(data: RawData): Uint8Array {
  const buf = Array.isArray(data)
    ? Buffer.concat(data)
    : Buffer.isBuffer(data)
      ? data
      : Buffer.from(data);
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.length);
}

/** Adapt a `ws` socket's post-pairing frames to the channel's byte `Transport`. */
function createSocketTransport(socket: WebSocket): {
  transport: Transport;
  deliverFrame(frame: Uint8Array | string): void;
  deliverClose(code: number, reason: string): void;
} {
  let onFrame: ((frame: Uint8Array | string) => void) | undefined;
  let onClose: ((code?: number, reason?: string) => void) | undefined;
  return {
    transport: {
      send: (bytes) => {
        if (socket.readyState === WebSocket.OPEN) socket.send(bytes);
      },
      onFrame: (h) => {
        onFrame = h;
      },
      onClose: (h) => {
        onClose = h;
      },
      close: (code, reason) => closeSocket(socket, code, reason),
    },
    deliverFrame: (frame) => onFrame?.(frame),
    deliverClose: (code, reason) => onClose?.(code, reason),
  };
}

/** Close with `code`; a code a close frame cannot carry falls back to 1000. */
function closeSocket(socket: WebSocket, code = 1000, reason = ""): void {
  if (socket.readyState === WebSocket.CLOSING || socket.readyState === WebSocket.CLOSED) return;
  try {
    socket.close(code, reason);
  } catch {
    socket.close(1000, "");
  }
}

/**
 * Dial the relay for `connectionId` and bring the data socket up. Synchronous: progress and
 * failures arrive through the connection's events (`onClose` fires once, whatever the cause).
 */
export function openRelayConnection(options: OpenRelayConnectionOptions): RelayConnection {
  const { url, sessionId, connectionId, keypair } = options;
  const logger = options.logger.child({ component: "relay-connection", connectionId });
  const limits = {
    maxFrameBytes: options.limits?.maxFrameBytes ?? RELAY_DEFAULTS.maxFrameBytes,
    attachTimeoutMs: options.limits?.attachTimeoutMs ?? RELAY_DEFAULTS.attachTimeoutMs,
    keyExchangeTimeoutMs:
      options.limits?.keyExchangeTimeoutMs ?? RELAY_DEFAULTS.keyExchangeTimeoutMs,
    silenceTimeoutMs: options.limits?.silenceTimeoutMs ?? RELAY_DEFAULTS.silenceTimeoutMs,
  };

  const socket = new WebSocket(url, {
    maxPayload: limits.maxFrameBytes,
    handshakeTimeout: RELAY_DEFAULTS.connectTimeoutMs,
  });
  const socketTransport = createSocketTransport(socket);

  const textHandlers: Array<(text: string) => void> = [];
  const binaryHandlers: Array<(bytes: Uint8Array) => void> = [];
  const closeHandlers: Array<(code: number, reason: string) => void> = [];

  let channel: Channel | null = null;
  let ready = false;
  let closedWith: { code: number; reason: string } | null = null;
  let setupTimer: ReturnType<typeof setTimeout> | undefined;
  let silenceTimer: ReturnType<typeof setTimeout> | undefined;
  let lastActivity = Date.now();

  /** The one place a connection ends: idempotent, clears timers, fires `onClose` once. */
  const finish = (code: number, reason: string): void => {
    if (closedWith) return;
    closedWith = { code, reason };
    ready = false;
    clearTimeout(setupTimer);
    clearTimeout(silenceTimer);
    logger.info({ code, reason }, "relay data socket closed");
    for (const h of closeHandlers) h(code, reason);
  };

  /** Close the socket with a relay code and end the connection. */
  const abort = (spec: { code: number; reason: string }): void => {
    closeSocket(socket, spec.code, spec.reason);
    finish(spec.code, spec.reason);
  };

  const armSilence = (): void => {
    const remaining = limits.silenceTimeoutMs - (Date.now() - lastActivity);
    silenceTimer = setTimeout(
      () => {
        if (Date.now() - lastActivity >= limits.silenceTimeoutMs) {
          logger.warn("relay data socket silent; closing");
          abort(RELAY_CLOSE.PING_TIMEOUT);
        } else {
          armSilence();
        }
      },
      Math.max(remaining, 1),
    );
  };
  const touch = (): void => {
    lastActivity = Date.now();
  };

  const startChannel = (): void => {
    clearTimeout(setupTimer);
    setupTimer = setTimeout(() => {
      logger.warn("no channel hello before the key-exchange timeout; closing");
      abort(RELAY_CLOSE.PROTOCOL_ERROR);
    }, limits.keyExchangeTimeoutMs);
    channel = createDaemonChannel({
      transport: socketTransport.transport,
      daemonKeypair: keypair,
      events: {
        onText: (text) => {
          for (const h of textHandlers) h(text);
        },
        onBinary: (bytes) => {
          for (const h of binaryHandlers) h(bytes);
        },
        onReady: () => {
          clearTimeout(setupTimer);
          ready = true;
        },
        onClose: (code, reason) => finish(code ?? 1006, reason ?? ""),
        // Channel errors carry a fixed phrase, never payload.
        onError: (cause) => logger.warn({ err: cause.message }, "relay channel error"),
      },
    });
  };

  socket.on("open", () => {
    logger.info("relay data socket opened");
    setupTimer = setTimeout(() => {
      logger.warn("relay did not pair the data socket in time; closing");
      abort(RELAY_CLOSE.PROTOCOL_ERROR);
    }, limits.attachTimeoutMs);
    touch();
    armSilence();
    socket.send(encodeControlFrame({ type: "relay_daemon_attach", v: 2, sessionId, connectionId }));
  });

  socket.on("ping", touch);

  socket.on("message", (data: RawData, isBinary: boolean) => {
    if (closedWith) return;
    touch();
    if (channel) {
      socketTransport.deliverFrame(isBinary ? toBytes(data) : decoder.decode(toBytes(data)));
      return;
    }
    // Before pairing only the relay's own control frame is valid.
    if (isBinary) return abort(RELAY_CLOSE.PROTOCOL_ERROR);
    const frame = parseRelayFrame(decoder.decode(toBytes(data)));
    if (frame?.type === "relay_paired" && frame.connectionId === connectionId) startChannel();
  });

  socket.on("error", (err: Error) => {
    logger.warn({ err: err.message }, "relay data socket error");
  });

  socket.on("close", (code: number, reasonBuf: Buffer) => {
    const reason = reasonBuf?.length ? reasonBuf.toString("utf8") : "";
    if (channel) socketTransport.deliverClose(code, reason);
    finish(code, reason);
  });

  const connection: RelayConnection = {
    connectionId,
    get bufferedAmount() {
      return socket.bufferedAmount;
    },
    get isOpen() {
      return ready && !closedWith && socket.readyState === WebSocket.OPEN;
    },
    sendText: (text) => {
      if (!connection.isOpen) return;
      try {
        channel?.send(text);
      } catch {
        // The channel already closed itself (counter limit) and reported through `onError`.
      }
    },
    sendBinary: (bytes) => {
      if (!connection.isOpen) return;
      try {
        channel?.sendBinary(bytes);
      } catch {
        // See `sendText`.
      }
    },
    close: (code = 1000, reason = "") => {
      closeSocket(socket, code, reason);
      finish(code, reason);
    },
    onText: (handler) => {
      textHandlers.push(handler);
    },
    onBinary: (handler) => {
      binaryHandlers.push(handler);
    },
    onClose: (handler) => {
      if (closedWith) handler(closedWith.code, closedWith.reason);
      else closeHandlers.push(handler);
    },
  };
  return connection;
}
