import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

import { SERVER_VERSION } from "../version.js";
import { HELLO_TIMEOUT_MS } from "../ws/limits.js";
import { createHostChecker, type HostnamesSetting } from "./host-allowlist.js";

/**
 * Daemon HTTP server (architecture/auth-security.md § Behavior, daemon-bootstrap.md § Entry points).
 *
 * Request pipeline:
 *  1. `GET /api/health` (`{status, version}`) is exempt from the Host check.
 *  2. Host-header allowlist (403 on mismatch).
 *  3. Everything else is 404.
 */

export const HEALTH_PATH = "/api/health";

export interface HttpServerDeps {
  hostnames?: HostnamesSetting;
  healthPath?: string;
  /** How long a connection may take to send its request headers (the WebSocket upgrade included). */
  headersTimeoutMs?: number;
}

/** Build the `(req, res)` listener implementing the pipeline above. */
export function createRequestListener(
  deps: HttpServerDeps,
): (req: IncomingMessage, res: ServerResponse) => void {
  const healthPath = deps.healthPath ?? HEALTH_PATH;
  const hostCheck = createHostChecker(deps.hostnames ?? []);

  return (req, res) => {
    const method = (req.method ?? "GET").toUpperCase();
    const path = (req.url ?? "/").split("?")[0];

    if (method === "GET" && path === healthPath) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ status: "ok", version: SERVER_VERSION }));
      return;
    }

    if (!hostCheck(req.headers.host)) {
      res.writeHead(403, { "content-type": "text/plain" });
      res.end("Host not allowed");
      return;
    }

    res.writeHead(404, { "content-type": "text/plain" });
    res.end("Not found");
  };
}

/**
 * Create (but do not start) the daemon HTTP server. A connection that never finishes its request
 * headers is closed after `headersTimeoutMs` (default `HELLO_TIMEOUT_MS`, the same time a WebSocket
 * gets to say `hello`); Node's own default is 60 s, checked only every 30 s, so a silent TCP
 * connection otherwise lives for over a minute.
 */
export function createHttpServer(deps: HttpServerDeps = {}): Server {
  const headersTimeout = deps.headersTimeoutMs ?? HELLO_TIMEOUT_MS;
  return createServer(
    { headersTimeout, connectionsCheckingInterval: Math.max(250, Math.floor(headersTimeout / 4)) },
    createRequestListener(deps),
  );
}

/**
 * Stop listening and drop every connection that is not an upgraded WebSocket (those belong to the
 * socket server): idle keep-alive sockets and requests still in flight are closed instead of being
 * waited for, so this settles at once. Resolves when the server is closed (also when it was not
 * listening).
 */
export function closeHttpServer(server: Server): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  server.close(() => resolve());
  server.closeAllConnections();
  return promise;
}
