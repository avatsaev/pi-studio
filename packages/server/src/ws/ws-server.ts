import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import type { IncomingMessage, Server as HttpServer } from "node:http";

import {
  helloSchema,
  SERVER_FEATURES,
  serverInfoPayloadSchema,
  statusSchema,
} from "@av-pi-studio/protocol";
import { WebSocketServer, type WebSocket } from "ws";

import type { PasswordAuth } from "../auth/password-auth.js";
import { WS_BEARER_SUBPROTOCOL_PREFIX } from "../auth/password-auth.js";
import { type CapabilityStore, createInMemoryCapabilityStore } from "./capability-store.js";
import type { Logger } from "../logging/logger.js";
import { HELLO_TIMEOUT_MS, MAX_FRAME_BYTES, PING_INTERVAL_MS } from "./limits.js";
import { watchLiveness } from "./liveness.js";
import { Session } from "./session.js";

/**
 * WebSocket server (architecture/websocket-protocol.md § Connection & handshake, § Behavior).
 *
 * On connection: validate Host + auth at upgrade, expect the first frame to be `hello`, register a
 * {@link Session}, persist/rehydrate the client's capabilities keyed by `clientId`, emit
 * `status`/`server_info`, then begin streaming. A non-`hello` first frame closes the socket.
 */

/** Message delivered to the router (task-005) after the handshake. */
export type SessionFrame = { text: string } | { binary: Uint8Array };

export interface WebSocketServerDeps {
  serverId: string;
  hostname?: string;
  version?: string;
  /** Server-side capability map echoed in `server_info.capabilities`. */
  serverCapabilities?: Record<string, unknown>;
  /** Advertised server features (`server_info.features`). Defaults to all SERVER_FEATURES enabled. */
  features?: Record<string, unknown>;
  auth?: PasswordAuth;
  /** Browser `Origin`s allowed on the direct port (exact match). Any other `Origin` is refused
   *  with 403; requests without an `Origin` (CLI, desktop) are unaffected. Default: none. */
  allowedOrigins?: readonly string[];
  hostCheck?: (hostHeader: string | undefined) => boolean;
  capabilityStore?: CapabilityStore;
  /** Called once a session completes its handshake. */
  onSession?: (session: Session) => void;
  /** Called when a session's socket closes — the hook a handler module uses to release
   *  per-session resources (subscriptions, watchers) it would otherwise leak forever on a
   *  dropped connection. A throwing callback never breaks socket teardown or `sessions`
   *  bookkeeping (guarded at the call site). */
  onSessionClose?: (session: Session) => void;
  /** Called for every post-handshake frame. */
  onMessage?: (session: Session, frame: SessionFrame) => void;
  /** Operational logger: upgrade rejections (warn), handshake failures (warn), session close (info). */
  logger?: Logger;
  /** How long a connection may stay open without a valid `hello` before it is closed with 1008.
   *  Default {@link HELLO_TIMEOUT_MS}; tests shorten it. */
  helloTimeoutMs?: number;
  /** How often every socket is pinged; one that showed no life since the previous ping is
   *  terminated. Default {@link PING_INTERVAL_MS}; tests shorten it. */
  pingIntervalMs?: number;
}

export interface WebSocketServerHandle {
  readonly wss: WebSocketServer;
  readonly sessions: Set<Session>;
  /** Answer every later upgrade with `503` (the daemon is shutting down). Idempotent. */
  stopAccepting(): void;
  /**
   * Stop accepting, close every socket with 1001 and resolve when they are gone. A socket that
   * has not completed the close handshake after {@link SOCKET_CLOSE_GRACE_MS} is terminated.
   */
  close(): Promise<void>;
}

/** How long `close()` waits for clients to answer the close frame before it terminates them. */
export const SOCKET_CLOSE_GRACE_MS = 1_000;

function defaultFeatures(): Record<string, boolean> {
  return Object.fromEntries(Object.values(SERVER_FEATURES).map((key) => [key, true]));
}

export function createWebSocketServer(
  httpServer: HttpServer,
  deps: WebSocketServerDeps,
): WebSocketServerHandle {
  const store = deps.capabilityStore ?? createInMemoryCapabilityStore();
  const sessions = new Set<Session>();
  let accepting = true;

  const wss = new WebSocketServer({
    noServer: true,
    // A frame above this closes the socket with 1009 while it is read, before it is buffered.
    maxPayload: MAX_FRAME_BYTES,
    // Echo the bearer subprotocol back so a browser client's offered protocol is accepted.
    handleProtocols: (protocols) => {
      for (const proto of protocols) {
        if (proto.startsWith(WS_BEARER_SUBPROTOCOL_PREFIX)) return proto;
      }
      return false;
    },
  });

  const stopLiveness = watchLiveness(wss, deps.pingIntervalMs ?? PING_INTERVAL_MS, deps.logger);

  httpServer.on("upgrade", (req, socket, head) => {
    if (!accepting) {
      deps.logger?.info(
        { remoteAddress: req.socket.remoteAddress },
        "ws upgrade refused: daemon shutting down",
      );
      socket.write("HTTP/1.1 503 Service Unavailable\r\n\r\n");
      socket.destroy();
      return;
    }
    if (deps.hostCheck && !deps.hostCheck(req.headers.host)) {
      deps.logger?.warn(
        { host: req.headers.host, remoteAddress: req.socket.remoteAddress },
        "ws upgrade rejected: host not allowed",
      );
      socket.write("HTTP/1.1 403 Host not allowed\r\n\r\n");
      socket.destroy();
      return;
    }
    const origin = req.headers.origin;
    if (origin !== undefined && !(deps.allowedOrigins ?? []).includes(origin)) {
      deps.logger?.warn(
        { origin, remoteAddress: req.socket.remoteAddress },
        "ws upgrade rejected: origin not allowed",
      );
      socket.write("HTTP/1.1 403 Origin not allowed\r\n\r\n");
      socket.destroy();
      return;
    }
    if (deps.auth && !deps.auth.authenticateUpgrade(req)) {
      deps.logger?.warn(
        { host: req.headers.host, remoteAddress: req.socket.remoteAddress },
        "ws upgrade rejected: unauthorized",
      );
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
  });

  wss.on("connection", (ws: WebSocket, _req: IncomingMessage) => {
    let session: Session | null = null;
    const connectedAt = Date.now();

    // A socket that never identifies itself is not held for ever.
    const helloTimer = setTimeout(() => {
      deps.logger?.warn(
        { remoteAddress: _req.socket.remoteAddress },
        "ws handshake failed: no hello before the timeout",
      );
      ws.close(1008, "hello timeout");
    }, deps.helloTimeoutMs ?? HELLO_TIMEOUT_MS);

    // `ws` reports a frame over `maxPayload` (and any protocol violation) as an `error` event after
    // it has started the close; without a listener that event would throw.
    ws.on("error", (err: Error) => {
      deps.logger?.warn(
        { err: err.message, remoteAddress: _req.socket.remoteAddress },
        "ws socket error; closing",
      );
    });

    ws.on("message", (data: Buffer, isBinary: boolean) => {
      if (session === null) {
        // First frame must be a valid JSON `hello`.
        if (isBinary) {
          deps.logger?.warn(
            { remoteAddress: _req.socket.remoteAddress },
            "ws handshake failed: binary first frame (expected hello)",
          );
          ws.close(1008, "expected hello");
          return;
        }
        let parsed: unknown;
        try {
          parsed = JSON.parse(data.toString("utf8"));
        } catch {
          deps.logger?.warn(
            { remoteAddress: _req.socket.remoteAddress },
            "ws handshake failed: invalid hello JSON",
          );
          ws.close(1008, "invalid hello");
          return;
        }
        const hello = helloSchema.safeParse(parsed);
        if (!hello.success) {
          deps.logger?.warn(
            { remoteAddress: _req.socket.remoteAddress },
            "ws handshake failed: first frame not a valid hello",
          );
          ws.close(1008, "first frame must be hello");
          return;
        }

        // Persist on hello; rehydrate stored caps when the hello omits them.
        const stored = store.get(hello.data.clientId);
        const capabilities = hello.data.capabilities ?? stored ?? {};
        store.set(hello.data.clientId, capabilities);

        session = new Session({
          id: randomUUID(),
          clientId: hello.data.clientId,
          clientType: hello.data.clientType,
          platform: hello.data.platform,
          agentStreams: hello.data.agentStreams,
          capabilities,
          socket: ws,
          appVersion: hello.data.appVersion,
          remoteAddress: _req.socket.remoteAddress,
          ...(deps.logger ? { logger: deps.logger } : {}),
        });
        clearTimeout(helloTimer);
        sessions.add(session);

        const payload = serverInfoPayloadSchema.parse({
          status: "server_info",
          serverId: deps.serverId,
          ...(deps.hostname ? { hostname: deps.hostname } : {}),
          ...(deps.version ? { version: deps.version } : {}),
          // The daemon host's home dir, so a client can expand `~` paths against the machine that
          // actually owns them instead of guessing from its own platform (root `AGENTS.md`
          // invariant 7's client-side half). A process fact, not injected config — same posture as
          // the `randomUUID()` session id above.
          homeDir: homedir(),
          capabilities: deps.serverCapabilities ?? {},
          features: deps.features ?? defaultFeatures(),
        });
        session.send(statusSchema.parse({ type: "status", payload }));
        deps.onSession?.(session);
        return;
      }

      // Post-handshake frames → router (task-005). A binary frame is handed over as a view of the
      // received buffer: the decoders copy a payload they keep, so nothing outlives the call.
      if (isBinary) {
        deps.onMessage?.(session, {
          binary: new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
        });
      } else deps.onMessage?.(session, { text: data.toString("utf8") });
    });

    ws.on("close", (code) => {
      clearTimeout(helloTimer);
      if (session) {
        sessions.delete(session);
        try {
          deps.onSessionClose?.(session);
        } catch (err) {
          deps.logger?.warn(
            { err, clientId: session.clientId },
            "onSessionClose callback threw; session teardown continues",
          );
        }
        deps.logger?.info(
          {
            clientId: session.clientId,
            clientType: session.clientType,
            code,
            durationMs: Date.now() - connectedAt,
          },
          "ws client disconnected",
        );
      }
    });
  });

  return {
    wss,
    sessions,
    stopAccepting(): void {
      accepting = false;
    },
    async close(): Promise<void> {
      accepting = false;
      stopLiveness();
      const { promise: closed, resolve } = Promise.withResolvers<void>();
      // `wss.close` settles only once every client socket is gone, and a client that never answers
      // the close frame stays for `ws`'s own 30 s closing timeout: terminate those after the grace.
      wss.close(() => resolve());
      for (const ws of wss.clients) ws.close(1001, "server shutting down");
      const grace = setTimeout(() => {
        for (const ws of wss.clients) ws.terminate();
      }, SOCKET_CLOSE_GRACE_MS);
      try {
        await closed;
      } finally {
        clearTimeout(grace);
      }
    },
  };
}
