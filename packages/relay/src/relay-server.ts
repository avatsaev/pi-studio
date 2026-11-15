/**
 * Standalone, runnable relay server for relay protocol 2 (architecture/relay-protocol.md § 1–3,
 * § Behavior — Relay). A plain Node WebSocket server, runnable via `node`/`npx`/the
 * `pi-studio relay` CLI command (`packages/cli`).
 *
 * Every socket's first frame says what it is: a daemon control socket, a client, or a daemon data
 * socket attaching for a waiting client. The relay pairs exactly one client socket with exactly one
 * data socket and then forwards every frame between them without reading it, so this process
 * structurally cannot read, forge or inject application messages: it sees addresses, timing, frame
 * sizes and session ids. Old-protocol (0.0.120) sockets are parked, idle and never answered.
 *
 * Flow control, WebSocket pings and the 1001 shutdown are layered on in a later task.
 */
import { createServer, type Server as HttpServer } from "node:http";
import { randomUUID } from "node:crypto";
import { WebSocketServer, type RawData, type WebSocket } from "ws";

import {
  RELAY_CLOSE,
  RELAY_DEFAULTS,
  encodeControlFrame,
  isForwardableCloseCode,
  newConnectionId,
  parseFirstFrame,
} from "./control.js";
import { createRelayLogger, type RelayLogger } from "./relay-logger.js";

// The logger is re-exported from this Node-only subpath so embedders spawning the server inline
// (packages/cli's relay-control.ts) can construct one from the same module URL they resolve for
// startRelayServer — without a second import.meta.resolve.
export {
  createRelayLogger,
  type RelayLogger,
  type CreateRelayLoggerOptions,
  type RelayLogLevel,
} from "./relay-logger.js";

/** Overridable limits and timers (`RELAY_DEFAULTS` supplies every value not given). */
export type RelayLimits = { -readonly [K in keyof typeof RELAY_DEFAULTS]: number };

export interface RelayServerOptions {
  /** Interface to bind. Defaults to all interfaces (`0.0.0.0`) since the relay must accept
   *  connections dialed in from other hosts — unlike the daemon, which defaults to localhost. */
  host?: string;
  port: number;
  /** Operational logger; defaults to a silent logger (tests, embedded use). `relay-main.ts`
   *  passes a real stdout logger. */
  logger?: RelayLogger;
  /** Overrides of `RELAY_DEFAULTS` (tests inject short timers and a small frame size). */
  limits?: Partial<RelayLimits>;
}

/** Read-only table sizes, for tests. */
export interface RelayCounts {
  controls: number;
  waiting: number;
  pairs: number;
  /** Old-protocol sockets, silent or not. */
  parked: number;
}

export interface RelayServerHandle {
  readonly host: string;
  readonly port: number;
  counts(): RelayCounts;
  flow(): RelayFlowStats;
  close(): Promise<void>;
}

/** Read-only flow-control and queue figures, for tests. */
export interface RelayFlowStats {
  /** Directions of pairs whose sender the relay is not reading right now. */
  pausedDirections: number;
  /** Highest `bufferedAmount` seen on a receiving socket right after a forward. */
  peakQueuedBytes: number;
}

const DEFAULT_RELAY_HOST = "0.0.0.0";

/** How often a paused direction checks whether its receiver has drained. */
const FLOW_POLL_MS = 10;
/** How long `close()` waits for sockets to answer a 1001 close before terminating them. */
const SHUTDOWN_GRACE_MS = 2_000;
/** Unanswered pings after which a socket is closed `ping_timeout`. */
const MAX_UNANSWERED_PINGS = 2;
const GOING_AWAY = { code: 1001, reason: "going away" } as const;

type Role = "new" | "control" | "waiting" | "parked" | "paired" | "closed";

/** One WebSocket and what the relay knows about it. */
interface Conn {
  ws: WebSocket;
  /** Short id correlating all log lines for one socket. */
  id: string;
  remoteAddress: string;
  role: Role;
  sessionId?: string;
  connectionId?: string;
  identifyTimer?: NodeJS.Timeout;
  parked?: ParkedEntry;
  pair?: Pair;
  /** Pings sent since the last pong. */
  unanswered: number;
  /** True while flow control keeps the relay from reading this socket. */
  readPaused: boolean;
}

interface ParkedEntry {
  conn: Conn;
  /** True until the socket sends a frame after registering (S9). */
  silent: boolean;
}

interface Waiting {
  connectionId: string;
  sessionId: string;
  client: Conn;
  since: number;
  attachTimer: NodeJS.Timeout;
}

/** One direction of a pair; `timer` is set exactly while the sender is paused. */
interface Flow {
  timer?: NodeJS.Timeout;
}

interface Pair {
  connectionId: string;
  sessionId: string;
  client: Conn;
  data: Conn;
  /** Milliseconds from the client's `relay_client_connect` to `relay_paired`. */
  timeToPairMs: number;
  pairedAt: number;
  bytesToDaemon: number;
  bytesToClient: number;
  finished: boolean;
  flowToDaemon: Flow;
  flowToClient: Flow;
}

function toText(data: RawData): string {
  return Buffer.isBuffer(data)
    ? data.toString("utf8")
    : Buffer.from(data as ArrayBuffer).toString("utf8");
}

function frameBytes(data: RawData): number {
  if (Buffer.isBuffer(data)) return data.length;
  if (Array.isArray(data)) return data.reduce((n, b) => n + b.length, 0);
  return data.byteLength;
}

/** Stop reading `from` until `to` drains to `lowWater` bytes or fewer (or is no longer open). */
function pauseSender(from: Conn, to: Conn, flow: Flow, lowWater: number): void {
  from.readPaused = true;
  from.ws.pause();
  flow.timer = setInterval(() => {
    if (to.ws.bufferedAmount <= lowWater || to.ws.readyState !== to.ws.OPEN) {
      resumeSender(from, flow);
    }
  }, FLOW_POLL_MS);
}

function resumeSender(from: Conn, flow: Flow): void {
  clearInterval(flow.timer);
  flow.timer = undefined;
  from.readPaused = false;
  from.ws.resume();
}

/**
 * Start a self-hosted relay: a WebSocket server pairing one client with one daemon data socket per
 * connection, plus a bare `GET /health` HTTP endpoint (200 `ok`) for liveness probes.
 */
export function startRelayServer(opts: RelayServerOptions): Promise<RelayServerHandle> {
  const host = opts.host ?? DEFAULT_RELAY_HOST;
  const log = opts.logger ?? createRelayLogger({ level: "silent" });
  const limits: RelayLimits = { ...RELAY_DEFAULTS, ...opts.limits };

  const controls = new Map<string, Conn>();
  const waiting = new Map<string, Waiting>();
  const pairs = new Map<string, Pair>();
  const parked = new Map<string, Set<ParkedEntry>>();
  /** Waiting plus paired connections per session id (D10). */
  const load = new Map<string, number>();

  const addLoad = (sessionId: string): void => {
    load.set(sessionId, (load.get(sessionId) ?? 0) + 1);
  };
  const releaseLoad = (sessionId: string): void => {
    const n = (load.get(sessionId) ?? 0) - 1;
    if (n > 0) load.set(sessionId, n);
    else load.delete(sessionId);
  };

  /** S9, the only place the silent-flag rule lives: dropping S9 means "any parked socket". */
  const looksLikeOutdatedDaemon = (sessionId: string): boolean => {
    const entries = parked.get(sessionId);
    if (!entries) return false;
    for (const e of entries) if (e.silent) return true;
    return false;
  };

  const refuse = (conn: Conn, spec: { code: number; reason: string }, detail: string): void => {
    log.warn(
      {
        conn: conn.id,
        remoteAddress: conn.remoteAddress,
        sessionId: conn.sessionId,
        code: spec.code,
        reason: spec.reason,
      },
      `refused: ${detail}`,
    );
    forget(conn);
    conn.role = "closed";
    conn.ws.close(spec.code, spec.reason);
  };

  /** Drop the table entries of a socket that is going away or is being refused. */
  const forget = (conn: Conn): void => {
    clearTimeout(conn.identifyTimer);
    if (conn.role === "waiting" && conn.connectionId) removeWaiting(conn.connectionId);
    if (conn.role === "parked" && conn.parked && conn.sessionId !== undefined) {
      const entries = parked.get(conn.sessionId);
      entries?.delete(conn.parked);
      if (entries?.size === 0) parked.delete(conn.sessionId);
    }
  };

  const removeWaiting = (connectionId: string): Waiting | undefined => {
    const w = waiting.get(connectionId);
    if (!w) return undefined;
    clearTimeout(w.attachTimer);
    waiting.delete(connectionId);
    releaseLoad(w.sessionId);
    return w;
  };

  const registerControl = (conn: Conn, sessionId: string): void => {
    conn.role = "control";
    conn.sessionId = sessionId;
    const old = controls.get(sessionId);
    controls.set(sessionId, conn);
    conn.ws.send(encodeControlFrame({ type: "relay_registered" }));
    log.info(
      { conn: conn.id, remoteAddress: conn.remoteAddress, sessionId },
      "control socket registered",
    );
    if (old) {
      log.info({ conn: old.id, sessionId, replacedBy: conn.id }, "control socket replaced");
      old.ws.close(RELAY_CLOSE.REPLACED.code, RELAY_CLOSE.REPLACED.reason);
    }
  };

  const park = (conn: Conn, sessionId: string): void => {
    const entry: ParkedEntry = { conn, silent: true };
    conn.role = "parked";
    conn.sessionId = sessionId;
    conn.parked = entry;
    let entries = parked.get(sessionId);
    if (!entries) parked.set(sessionId, (entries = new Set()));
    entries.add(entry);
    log.info(
      { conn: conn.id, remoteAddress: conn.remoteAddress, sessionId },
      "parked old-protocol socket",
    );
  };

  const connectClient = (conn: Conn, sessionId: string): void => {
    conn.sessionId = sessionId;
    const control = controls.get(sessionId);
    if (!control) {
      const spec = looksLikeOutdatedDaemon(sessionId)
        ? RELAY_CLOSE.DAEMON_OUTDATED
        : RELAY_CLOSE.DAEMON_OFFLINE;
      refuse(conn, spec, "no control socket for session");
      return;
    }
    if ((load.get(sessionId) ?? 0) >= limits.maxClientsPerDaemon) {
      refuse(conn, RELAY_CLOSE.TOO_MANY_CLIENTS, "session is at its client limit");
      return;
    }
    const connectionId = newConnectionId();
    conn.role = "waiting";
    conn.connectionId = connectionId;
    addLoad(sessionId);
    waiting.set(connectionId, {
      connectionId,
      sessionId,
      client: conn,
      since: Date.now(),
      attachTimer: setTimeout(
        () => refuse(conn, RELAY_CLOSE.DAEMON_UNRESPONSIVE, "daemon did not attach in time"),
        limits.attachTimeoutMs,
      ),
    });
    control.ws.send(encodeControlFrame({ type: "relay_dial", connectionId }));
    log.debug({ conn: conn.id, sessionId, connectionId }, "dialed daemon for client");
  };

  const attachData = (conn: Conn, sessionId: string, connectionId: string): void => {
    conn.sessionId = sessionId;
    const w = waiting.get(connectionId);
    if (!w || w.sessionId !== sessionId) {
      refuse(conn, RELAY_CLOSE.UNKNOWN_CONNECTION, "no such waiting connection");
      return;
    }
    // The waiting entry becomes a pair; the session's load count carries over.
    clearTimeout(w.attachTimer);
    waiting.delete(connectionId);
    clearTimeout(conn.identifyTimer);
    const now = Date.now();
    const pair: Pair = {
      connectionId,
      sessionId,
      client: w.client,
      data: conn,
      timeToPairMs: now - w.since,
      pairedAt: now,
      bytesToDaemon: 0,
      bytesToClient: 0,
      finished: false,
      flowToDaemon: {},
      flowToClient: {},
    };
    pairs.set(connectionId, pair);
    w.client.role = "paired";
    w.client.pair = pair;
    conn.role = "paired";
    conn.pair = pair;
    conn.connectionId = connectionId;
    const paired = encodeControlFrame({ type: "relay_paired", connectionId });
    w.client.ws.send(paired);
    conn.ws.send(paired);
    log.debug({ connectionId, sessionId }, "paired");
  };

  const endPair = (pair: Pair, closed: Conn, code: number, reason: string): void => {
    if (pair.finished) return;
    pair.finished = true;
    pairs.delete(pair.connectionId);
    releaseLoad(pair.sessionId);
    // A paused sender cannot read its peer's close reply, so release both before closing.
    for (const [from, flow] of [
      [pair.client, pair.flowToDaemon],
      [pair.data, pair.flowToClient],
    ] as const) {
      if (flow.timer) resumeSender(from, flow);
    }
    const other = closed === pair.client ? pair.data : pair.client;
    other.role = "closed";
    if (isForwardableCloseCode(code)) other.ws.close(code, reason);
    else other.ws.close(RELAY_CLOSE.PEER_CLOSED.code, RELAY_CLOSE.PEER_CLOSED.reason);
    log.info(
      {
        connectionId: pair.connectionId,
        sessionId: pair.sessionId,
        timeToPairMs: pair.timeToPairMs,
        bytesToDaemon: pair.bytesToDaemon,
        bytesToClient: pair.bytesToClient,
        durationMs: Date.now() - pair.pairedAt,
        closedBy: closed === pair.client ? "client" : "daemon",
        code,
        reason,
      },
      "pair closed",
    );
  };

  const onFirstFrame = (conn: Conn, data: RawData, isBinary: boolean): void => {
    clearTimeout(conn.identifyTimer);
    const first = isBinary ? ({ kind: "invalid" } as const) : parseFirstFrame(toText(data));
    switch (first.kind) {
      case "invalid":
        refuse(conn, RELAY_CLOSE.PROTOCOL_ERROR, "invalid first frame");
        return;
      case "legacy":
        park(conn, first.sessionId);
        return;
      case "daemon_register":
        registerControl(conn, first.sessionId);
        return;
      case "client_connect":
        connectClient(conn, first.sessionId);
        return;
      case "daemon_attach":
        attachData(conn, first.sessionId, first.connectionId);
        return;
    }
  };

  /** Every open socket, whatever its role: all of them are pinged. */
  const conns = new Set<Conn>();
  let peakQueuedBytes = 0;

  /** Forward one frame of a pair, pausing its sender while the receiver's queue is above the high mark. */
  const forward = (pair: Pair, from: Conn, data: RawData, isBinary: boolean): void => {
    const toDaemon = from === pair.client;
    const bytes = frameBytes(data);
    if (toDaemon) pair.bytesToDaemon += bytes;
    else pair.bytesToClient += bytes;
    const to = toDaemon ? pair.data : pair.client;
    if (to.ws.readyState !== to.ws.OPEN) return;
    to.ws.send(data, { binary: isBinary });
    const queued = to.ws.bufferedAmount;
    if (queued > peakQueuedBytes) peakQueuedBytes = queued;
    const flow = toDaemon ? pair.flowToDaemon : pair.flowToClient;
    if (!flow.timer && queued > limits.flowHighWaterBytes) {
      pauseSender(from, to, flow, limits.flowLowWaterBytes);
    }
  };

  /** Table cleanup for a socket that has closed, or is being dropped as dead. */
  const onSocketClosed = (conn: Conn, code: number, reason: string): void => {
    const role = conn.role;
    if (role === "paired" && conn.pair) {
      endPair(conn.pair, conn, code, reason);
    } else if (role === "control" && conn.sessionId !== undefined) {
      // Only the current control socket leaves the table; waiting entries and pairs stay (D15).
      if (controls.get(conn.sessionId) === conn) controls.delete(conn.sessionId);
      log.info({ conn: conn.id, sessionId: conn.sessionId, code }, "control socket closed");
    } else {
      forget(conn);
    }
    conn.role = "closed";
  };

  /**
   * Every interval: close sockets with two unanswered pings, ping the rest. A socket whose reads
   * flow control has paused cannot answer, and the pause is the relay's doing, so it is not dead.
   */
  const pingAll = (): void => {
    for (const conn of conns) {
      if (conn.ws.readyState !== conn.ws.OPEN) continue;
      if (conn.readPaused) {
        conn.unanswered = 0;
        continue;
      }
      if (conn.unanswered >= MAX_UNANSWERED_PINGS) {
        const spec = RELAY_CLOSE.PING_TIMEOUT;
        log.warn(
          { conn: conn.id, remoteAddress: conn.remoteAddress, sessionId: conn.sessionId },
          "closing: ping timeout",
        );
        // A dead peer never completes the close handshake, so the tables are cleaned up now.
        onSocketClosed(conn, spec.code, spec.reason);
        conn.ws.close(spec.code, spec.reason);
        continue;
      }
      conn.unanswered++;
      conn.ws.ping();
    }
  };
  const pingTimer = setInterval(pingAll, limits.pingIntervalMs);

  const httpServer: HttpServer = createServer((req, res) => {
    if (req.method === "GET" && req.url === "/health") {
      res.writeHead(200, { "content-type": "text/plain; charset=utf-8" }).end("ok");
      return;
    }
    res.writeHead(404).end();
  });

  const wss = new WebSocketServer({ server: httpServer, maxPayload: limits.maxFrameBytes });
  wss.on("connection", (ws: WebSocket, req) => {
    const conn: Conn = {
      ws,
      id: randomUUID().slice(0, 8),
      remoteAddress: req.socket.remoteAddress ?? "unknown",
      role: "new",
      unanswered: 0,
      readPaused: false,
    };
    conns.add(conn);
    ws.on("pong", () => {
      conn.unanswered = 0;
    });
    log.debug({ conn: conn.id, remoteAddress: conn.remoteAddress }, "connection open");
    conn.identifyTimer = setTimeout(
      () => refuse(conn, RELAY_CLOSE.IDENTIFY_TIMEOUT, "no first frame in time"),
      limits.identifyTimeoutMs,
    );

    ws.on("error", (err) => {
      log.error(
        { conn: conn.id, remoteAddress: conn.remoteAddress, err: err.message },
        "socket error",
      );
    });

    ws.on("message", (data: RawData, isBinary: boolean) => {
      switch (conn.role) {
        case "paired":
          // Never parsed: forwarded unchanged, in order.
          forward(conn.pair!, conn, data, isBinary);
          return;
        case "new":
          onFirstFrame(conn, data, isBinary);
          return;
        case "waiting":
          refuse(conn, RELAY_CLOSE.PROTOCOL_ERROR, "client frame before relay_paired");
          return;
        case "parked":
          // A later frame clears the silent flag (S9); the frame itself is ignored.
          if (conn.parked) conn.parked.silent = false;
          return;
        case "control":
        case "closed":
          return;
      }
    });

    ws.on("close", (code: number, reasonBuf: Buffer) => {
      conns.delete(conn);
      log.debug({ conn: conn.id, code }, "connection closed");
      onSocketClosed(conn, code, reasonBuf.toString("utf8"));
    });
  });

  return new Promise<RelayServerHandle>((resolve, reject) => {
    httpServer.on("error", reject);
    httpServer.listen(opts.port, host, () => {
      httpServer.off("error", reject);
      const addr = httpServer.address();
      const actualPort = typeof addr === "object" && addr ? addr.port : opts.port;
      resolve({
        host,
        port: actualPort,
        counts: () => ({
          controls: controls.size,
          waiting: waiting.size,
          pairs: pairs.size,
          parked: [...parked.values()].reduce((n, s) => n + s.size, 0),
        }),
        flow: () => {
          let pausedDirections = 0;
          for (const p of pairs.values()) {
            if (p.flowToDaemon.timer) pausedDirections++;
            if (p.flowToClient.timer) pausedDirections++;
          }
          return { pausedDirections, peakQueuedBytes };
        },
        close: async () => {
          clearInterval(pingTimer);
          // Release paused senders first: a paused socket cannot read the close reply.
          for (const p of pairs.values()) {
            if (p.flowToDaemon.timer) resumeSender(p.client, p.flowToDaemon);
            if (p.flowToClient.timer) resumeSender(p.data, p.flowToClient);
          }
          const answered: Array<Promise<void>> = [];
          for (const conn of conns) {
            if (conn.ws.readyState !== conn.ws.OPEN) continue;
            answered.push(new Promise<void>((done) => conn.ws.once("close", () => done())));
            conn.ws.close(GOING_AWAY.code, GOING_AWAY.reason);
          }
          let grace: NodeJS.Timeout | undefined;
          await Promise.race([
            Promise.all(answered),
            new Promise<void>((done) => (grace = setTimeout(done, SHUTDOWN_GRACE_MS))),
          ]);
          clearTimeout(grace);
          for (const conn of conns) conn.ws.terminate();
          await new Promise<void>((done) => wss.close(() => httpServer.close(() => done())));
        },
      });
    });
  });
}
