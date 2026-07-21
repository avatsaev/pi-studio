/**
 * Standalone, runnable relay server (architecture/relay-e2ee.md § Purpose, § Behavior — Connection
 * setup; MAIN-SCOPE.md § 6 — "Relay | Remote access | WebSocket + NaCl box | Hosted or
 * self-hosted"). This is the **self-hosted** counterpart to `cf-adapter.ts`'s Cloudflare Workers
 * adapter: a plain Node WebSocket server wired to the same platform-agnostic `RelaySessionBridge`
 * (`session-bridge.ts`), runnable directly via `node`/`npx`/the `pi-studio relay` CLI command
 * (`packages/cli`).
 *
 * The relay is untrusted and zero-knowledge by construction: `RelaySessionBridge.attach()` never
 * inspects a socket's traffic past the registration frame, so this process structurally cannot
 * read, forge, or inject application messages — it only ever sees the `relay_register` frame,
 * connection metadata (IPs, timing, sizes), and (once a client attaches) the plaintext ephemeral
 * public key in the `e2ee_hello` handshake frame.
 */
import { createServer, type Server as HttpServer } from "node:http";
import { randomUUID } from "node:crypto";
import { WebSocketServer, type WebSocket } from "ws";

import { RelaySessionBridge, type RelaySocket } from "./session-bridge.js";
import { createRelayLogger, type RelayLogger } from "./relay-logger.js";

// The logger is re-exported from this Node-only subpath so embedders spawning the server inline
// (packages/cli's relay-control.ts) can construct one from the same module URL they resolve for
// startRelayServer — without a second import.meta.resolve.
export { createRelayLogger, type RelayLogger, type CreateRelayLoggerOptions, type RelayLogLevel } from "./relay-logger.js";

export interface RelayServerOptions {
  /** Interface to bind. Defaults to all interfaces (`0.0.0.0`) since the relay must accept
   *  connections dialed in from other hosts — unlike the daemon, which defaults to localhost. */
  host?: string;
  port: number;
  /** Operational logger; defaults to a silent logger (tests, embedded use). `relay-main.ts`
   *  passes a real stdout logger. */
  logger?: RelayLogger;
}

export interface RelayServerHandle {
  readonly host: string;
  readonly port: number;
  readonly bridge: RelaySessionBridge;
  close(): Promise<void>;
}

const DEFAULT_RELAY_HOST = "0.0.0.0";

function wrapWsSocket(ws: WebSocket, meta: RelaySocketMeta): RelaySocket {
  const messageHandlers: Array<(data: string) => void> = [];
  ws.on("message", (data: Buffer, isBinary: boolean) => {
    if (isBinary) return;
    const text = data.toString("utf8");
    meta.bytesIn += text.length;
    for (const h of messageHandlers) h(text);
  });
  return {
    send: (data) => {
      if (ws.readyState === ws.OPEN) {
        meta.bytesOut += data.length;
        ws.send(data);
      }
    },
    onMessage: (h) => messageHandlers.push(h),
    onClose: (h) => ws.on("close", (code, reasonBuf: Buffer) => h(reasonBuf.toString("utf8") || `code ${code}`)),
    close: (code, reason) => ws.close(code, reason),
  };
}

/** Per-connection metadata, tracked for close-time summary logs. */
interface RelaySocketMeta {
  /** Short id correlating all log lines for one connection. */
  conn: string;
  remoteAddress: string;
  connectedAt: number;
  bytesIn: number;
  bytesOut: number;
}

/**
 * Start a self-hosted relay: a WebSocket server bridging connections by session id
 * (`RelaySessionBridge`), plus a bare `GET /health` HTTP endpoint (200 `ok`) for liveness probes.
 * Every WebSocket connection — daemon or client — is treated identically; the bridge doesn't
 * distinguish roles, only session ids (architecture/relay-e2ee.md § Behavior).
 */
export function startRelayServer(opts: RelayServerOptions): Promise<RelayServerHandle> {
  const host = opts.host ?? DEFAULT_RELAY_HOST;
  const log = opts.logger ?? createRelayLogger({ level: "silent" });

  // Connection metadata keyed by the bridged socket, so bridge lifecycle hooks can log with
  // connection context (id + remote address) without the bridge knowing anything about transports.
  const metas = new WeakMap<RelaySocket, RelaySocketMeta>();
  const metaOf = (s: RelaySocket): RelaySocketMeta | undefined => metas.get(s);

  const bridge = new RelaySessionBridge({
    onRegisterRejected: (socket) => {
      const m = metaOf(socket);
      log.warn({ conn: m?.conn, remoteAddress: m?.remoteAddress }, "ignored frame before registration (first frame must be relay_register)");
    },
    onRegister: (socket, sessionId, peers) => {
      const m = metaOf(socket);
      log.info({ conn: m?.conn, remoteAddress: m?.remoteAddress, sessionId, peers }, peers === 2 ? "session registered — both peers attached" : "session registered");
    },
    onForward: (sessionId, bytes) => {
      log.trace({ sessionId, bytes }, "frame forwarded");
    },
    onUnregister: (socket, sessionId, peers) => {
      const m = metaOf(socket);
      log.info({ conn: m?.conn, sessionId, peers }, peers === 0 ? "peer detached — session idle" : "peer detached");
    },
  });

  const httpServer: HttpServer = createServer((req, res) => {
    if (req.method === "GET" && req.url === "/health") {
      res.writeHead(200, { "content-type": "text/plain; charset=utf-8" }).end("ok");
      return;
    }
    res.writeHead(404).end();
  });

  const wss = new WebSocketServer({ server: httpServer });
  wss.on("connection", (ws: WebSocket, req) => {
    const meta: RelaySocketMeta = {
      conn: randomUUID().slice(0, 8),
      remoteAddress: req.socket.remoteAddress ?? "unknown",
      connectedAt: Date.now(),
      bytesIn: 0,
      bytesOut: 0,
    };
    log.info({ conn: meta.conn, remoteAddress: meta.remoteAddress }, "connection open");
    ws.on("error", (err) => {
      log.error({ conn: meta.conn, remoteAddress: meta.remoteAddress, err: err.message }, "socket error");
    });
    ws.on("close", (code) => {
      log.info(
        {
          conn: meta.conn,
          remoteAddress: meta.remoteAddress,
          code,
          durationMs: Date.now() - meta.connectedAt,
          bytesIn: meta.bytesIn,
          bytesOut: meta.bytesOut,
        },
        "connection closed",
      );
    });
    const socket = wrapWsSocket(ws, meta);
    metas.set(socket, meta);
    bridge.attach(socket);
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
        bridge,
        close: () =>
          new Promise<void>((resolveClosed) => {
            wss.close(() => httpServer.close(() => resolveClosed()));
          }),
      });
    });
  });
}
