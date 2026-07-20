import { randomUUID } from "node:crypto";
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
  hostCheck?: (hostHeader: string | undefined) => boolean;
  capabilityStore?: CapabilityStore;
  /** Called once a session completes its handshake. */
  onSession?: (session: Session) => void;
  /** Called for every post-handshake frame. */
  onMessage?: (session: Session, frame: SessionFrame) => void;
  /** Operational logger: upgrade rejections (warn), handshake failures (warn), session close (info). */
  logger?: Logger;
}

export interface WebSocketServerHandle {
  readonly wss: WebSocketServer;
  readonly sessions: Set<Session>;
  close(): Promise<void>;
}

function defaultFeatures(): Record<string, boolean> {
  return Object.fromEntries(Object.values(SERVER_FEATURES).map((key) => [key, true]));
}

export function createWebSocketServer(
  httpServer: HttpServer,
  deps: WebSocketServerDeps,
): WebSocketServerHandle {
  const store = deps.capabilityStore ?? createInMemoryCapabilityStore();
  const sessions = new Set<Session>();

  const wss = new WebSocketServer({
    noServer: true,
    // Echo the bearer subprotocol back so a browser client's offered protocol is accepted.
    handleProtocols: (protocols) => {
      for (const proto of protocols) {
        if (proto.startsWith(WS_BEARER_SUBPROTOCOL_PREFIX)) return proto;
      }
      return false;
    },
  });

  httpServer.on("upgrade", (req, socket, head) => {
    if (deps.hostCheck && !deps.hostCheck(req.headers.host)) {
      deps.logger?.warn(
        { host: req.headers.host, remoteAddress: req.socket.remoteAddress },
        "ws upgrade rejected: host not allowed",
      );
      socket.write("HTTP/1.1 403 Host not allowed\r\n\r\n");
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

    ws.on("message", (data: Buffer, isBinary: boolean) => {
      if (session === null) {
        // First frame must be a valid JSON `hello`.
        if (isBinary) {
          deps.logger?.warn({ remoteAddress: _req.socket.remoteAddress }, "ws handshake failed: binary first frame (expected hello)");
          ws.close(1008, "expected hello");
          return;
        }
        let parsed: unknown;
        try {
          parsed = JSON.parse(data.toString("utf8"));
        } catch {
          deps.logger?.warn({ remoteAddress: _req.socket.remoteAddress }, "ws handshake failed: invalid hello JSON");
          ws.close(1008, "invalid hello");
          return;
        }
        const hello = helloSchema.safeParse(parsed);
        if (!hello.success) {
          deps.logger?.warn({ remoteAddress: _req.socket.remoteAddress }, "ws handshake failed: first frame not a valid hello");
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
          capabilities,
          socket: ws,
        });
        sessions.add(session);

        const payload = serverInfoPayloadSchema.parse({
          status: "server_info",
          serverId: deps.serverId,
          ...(deps.hostname ? { hostname: deps.hostname } : {}),
          ...(deps.version ? { version: deps.version } : {}),
          capabilities: deps.serverCapabilities ?? {},
          features: deps.features ?? defaultFeatures(),
        });
        session.send(statusSchema.parse({ type: "status", payload }));
        deps.onSession?.(session);
        return;
      }

      // Post-handshake frames → router (task-005).
      if (isBinary) deps.onMessage?.(session, { binary: new Uint8Array(data) });
      else deps.onMessage?.(session, { text: data.toString("utf8") });
    });

    ws.on("close", (code) => {
      if (session) {
        sessions.delete(session);
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
    async close(): Promise<void> {
      for (const session of sessions) session.close(1001, "server shutting down");
      await new Promise<void>((resolve) => wss.close(() => resolve()));
    },
  };
}
