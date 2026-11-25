/**
 * Daemon-side outbound relay transport (architecture/relay-protocol.md § Behavior — Daemon (control
 * loop), § 2, § 3, § Error handling; features/relay-multi-client.md § Public contract 2).
 *
 * The daemon dials OUTBOUND to a relay (no inbound port to open) and keeps ONE control socket
 * registered under its session id with protocol 2. Each `relay_dial { connectionId }` the relay
 * sends on it makes the daemon open a data socket (`openRelayConnection`, at most 32 at a time) and
 * hand the resulting {@link RelayConnection} to `onConnection`. Sessions, `hello` handling and
 * disposal live above this module (`relay-sessions.ts`, wired in `bootstrap.ts`).
 *
 * The session id is `deriveRelaySessionId(keypair.publicKey)` — deterministic — so a pairing link
 * printed once keeps working across control-socket drops and relay restarts.
 *
 * The control socket is redialed with backoff (1, 2, 4 … 30 s, ±20 % jitter) when it closes, when
 * the relay does not answer the registration within 10 s (an outdated relay) and when it stays
 * silent for 90 s (no frame and no ping). A control drop never touches the data connections: they
 * are independent sockets and end only when their own socket closes.
 */
import { WebSocket } from "ws";

import {
  deriveRelaySessionId,
  encodeControlFrame,
  parseRelayFrame,
  RELAY_CLOSE,
  RELAY_DEFAULTS,
} from "@av-pi-studio/relay";

import type { Logger } from "../logging/logger.js";
import {
  openRelayConnection,
  type RelayConnection,
  type RelayConnectionLimits,
} from "./relay-connection.js";

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

/** Timers and sizes tests may shorten; `RELAY_DEFAULTS` supplies every value not given. */
export interface RelayTransportLimits extends RelayConnectionLimits {
  /** Data sockets open at once; further `relay_dial`s are ignored. */
  maxConnections?: number;
  /** Wait for `relay_registered` before deciding the relay is outdated. */
  registrationAnswerTimeoutMs?: number;
  backoffInitialMs?: number;
  backoffMaxMs?: number;
  /** Fraction of the delay added or removed at random (0.2 = ±20 %). */
  backoffJitter?: number;
  /** Wait after the relay closed the control socket with `replaced`. */
  replacedWaitMs?: number;
}

/** The slice of the timer API the control loop uses; tests inject a recording fake. */
export interface RelayTimers {
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface RelayTransportOptions {
  /** Called once per `relay_dial`, with the connection that is being opened. */
  onConnection: (conn: RelayConnection) => void;
  logger: Logger;
  limits?: RelayTransportLimits;
  /** Jitter source in `[0, 1)`; defaults to `Math.random`. */
  random?: () => number;
  timers?: RelayTimers;
}

export interface RelayTransportHandle {
  readonly sessionId: string;
  /** Ignore every later `relay_dial` (the daemon is shutting down); open connections stay. */
  stopAccepting(): void;
  /** Stop redialing, close the control socket and every open data socket. */
  close(): void;
}

const systemTimers: RelayTimers = {
  setTimeout: (callback, ms) => setTimeout(callback, ms),
  clearTimeout: (handle) => clearTimeout(handle as NodeJS.Timeout),
};

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

/**
 * Open the control socket and keep it registered; see the module comment. Returns at once: dial
 * progress and failures are logged, never thrown (an unreachable relay is retried with backoff).
 */
export function connectRelay(
  keypair: DaemonKeypair,
  config: RelayConfig,
  options: RelayTransportOptions,
): RelayTransportHandle {
  const url = relayUrl(config);
  const sessionId = deriveRelaySessionId(keypair.publicKey);
  const logger = options.logger.child({ component: "relay", sessionId });
  const random = options.random ?? Math.random;
  const timers = options.timers ?? systemTimers;
  const limits = {
    maxConnections: options.limits?.maxConnections ?? RELAY_DEFAULTS.maxClientsPerDaemon,
    maxFrameBytes: options.limits?.maxFrameBytes ?? RELAY_DEFAULTS.maxFrameBytes,
    silenceTimeoutMs: options.limits?.silenceTimeoutMs ?? RELAY_DEFAULTS.silenceTimeoutMs,
    registrationAnswerTimeoutMs:
      options.limits?.registrationAnswerTimeoutMs ?? RELAY_DEFAULTS.registrationAnswerTimeoutMs,
    backoffInitialMs: options.limits?.backoffInitialMs ?? RELAY_DEFAULTS.backoffInitialMs,
    backoffMaxMs: options.limits?.backoffMaxMs ?? RELAY_DEFAULTS.backoffMaxMs,
    backoffJitter: options.limits?.backoffJitter ?? RELAY_DEFAULTS.backoffJitter,
    replacedWaitMs: options.limits?.replacedWaitMs ?? RELAY_DEFAULTS.replacedWaitMs,
  };

  const connections = new Set<RelayConnection>();
  let closed = false;
  let accepting = true;
  let controlSocket: WebSocket | null = null;
  let redialTimer: unknown;
  /** Consecutive control-socket failures since the last `relay_registered`. */
  let failures = 0;

  /** The next backoff delay: initial · 2^failures, capped, with ± jitter. Advances `failures`. */
  const nextBackoffMs = (): number => {
    const base = Math.min(limits.backoffInitialMs * 2 ** failures, limits.backoffMaxMs);
    failures += 1;
    const spread = (random() * 2 - 1) * limits.backoffJitter;
    return Math.round(base * (1 + spread));
  };

  const handleDial = (connectionId: string): void => {
    if (!accepting) {
      logger.info({ connectionId }, "relay_dial ignored: daemon shutting down");
      return;
    }
    if (connections.size >= limits.maxConnections) {
      logger.warn(
        { connectionId, open: connections.size, max: limits.maxConnections },
        "relay_dial ignored: too many open connections",
      );
      return;
    }
    const conn = openRelayConnection({
      url,
      sessionId,
      connectionId,
      keypair,
      limits: options.limits,
      logger: options.logger,
    });
    connections.add(conn);
    conn.onClose(() => connections.delete(conn));
    try {
      options.onConnection(conn);
    } catch (err) {
      logger.error(
        { connectionId, err: (err as Error)?.message ?? String(err) },
        "relay onConnection threw; closing the connection",
      );
      conn.close(1011, "internal error");
    }
  };

  const dial = (): void => {
    if (closed) return;
    const socket = new WebSocket(url, {
      maxPayload: limits.maxFrameBytes,
      handshakeTimeout: RELAY_DEFAULTS.connectTimeoutMs,
    });
    controlSocket = socket;
    let ended = false;
    let registered = false;
    let registrationTimer: unknown;
    let silenceTimer: unknown;

    /** The one place a control socket ends: idempotent; clears timers; schedules the redial. */
    const end = (code: number, reason: string): void => {
      if (ended) return;
      ended = true;
      timers.clearTimeout(registrationTimer);
      timers.clearTimeout(silenceTimer);
      if (controlSocket === socket) controlSocket = null;
      if (closed) return;
      let delayMs: number;
      if (code === RELAY_CLOSE.REPLACED.code) {
        delayMs = limits.replacedWaitMs;
        logger.warn(
          "relay control socket replaced: another daemon is registered with this key; " +
            "waiting before registering again",
        );
      } else {
        delayMs = nextBackoffMs();
      }
      logger.info({ code, reason, nextRedialMs: delayMs }, "relay control socket closed");
      redialTimer = timers.setTimeout(dial, delayMs);
    };

    /** Abandon a socket the relay will not close for us (no answer, silence). */
    const drop = (code: number, reason: string): void => {
      socket.terminate();
      end(code, reason);
    };

    const armSilence = (): void => {
      timers.clearTimeout(silenceTimer);
      silenceTimer = timers.setTimeout(() => {
        logger.warn(
          { silenceTimeoutMs: limits.silenceTimeoutMs },
          "relay control socket silent; redialing",
        );
        drop(RELAY_CLOSE.PING_TIMEOUT.code, "silence");
      }, limits.silenceTimeoutMs);
    };

    socket.on("open", () => {
      logger.info("relay connected");
      socket.send(encodeControlFrame({ type: "relay_daemon_register", v: 2, sessionId }));
      registrationTimer = timers.setTimeout(() => {
        logger.warn(
          { registrationAnswerTimeoutMs: limits.registrationAnswerTimeoutMs },
          "relay did not answer the registration: it speaks an older protocol and must be updated",
        );
        drop(1000, "registration timeout");
      }, limits.registrationAnswerTimeoutMs);
      armSilence();
    });

    socket.on("ping", armSilence);

    socket.on("message", (data: Buffer | ArrayBuffer | Buffer[], isBinary: boolean) => {
      if (ended) return;
      armSilence();
      if (isBinary) return; // the control socket carries text frames only
      const text = Array.isArray(data)
        ? Buffer.concat(data).toString("utf8")
        : Buffer.isBuffer(data)
          ? data.toString("utf8")
          : Buffer.from(data).toString("utf8");
      const frame = parseRelayFrame(text);
      if (frame?.type === "relay_registered") {
        timers.clearTimeout(registrationTimer);
        registered = true;
        failures = 0;
        logger.info("relay registered");
      } else if (frame?.type === "relay_dial" && registered) {
        handleDial(frame.connectionId);
      }
      // Anything else (unknown or malformed control frame) is ignored.
    });

    socket.on("error", (err: Error) => {
      logger.warn({ err: err.message }, "relay control socket error");
    });

    socket.on("close", (code: number, reasonBuf: Buffer) => {
      end(code, reasonBuf?.length ? reasonBuf.toString("utf8") : "");
    });
  };

  dial();

  return {
    sessionId,
    stopAccepting() {
      accepting = false;
    },
    close() {
      accepting = false;
      if (closed) return;
      closed = true;
      timers.clearTimeout(redialTimer);
      controlSocket?.terminate();
      controlSocket = null;
      for (const conn of connections) conn.close(1001, "daemon shutting down");
      connections.clear();
    },
  };
}
