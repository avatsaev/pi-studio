import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

import { createHostChecker, type HostnamesSetting } from "./host-allowlist.js";

/**
 * Daemon HTTP server (architecture/auth-security.md § Behavior, daemon-bootstrap.md § Entry points).
 *
 * Request pipeline:
 *  1. `OPTIONS` preflight and `GET /api/health` are exempt from Host + auth checks.
 *  2. Host-header allowlist (403 on mismatch).
 *  3. CORS headers (`daemon.cors.allowedOrigins`).
 *  4. Optional bearer auth (wired in task-003).
 *  5. Delegate to `onRequest` (mcp/file routes, later sprints) else 404.
 */

export const HEALTH_PATH = "/api/health";

export interface HttpServerDeps {
  hostnames?: HostnamesSetting;
  allowedOrigins?: string[];
  healthPath?: string;
  /** Optional bearer-auth predicate (task-003). Return `false` to reject with 401. */
  authenticate?: (req: IncomingMessage) => boolean;
  /** Optional application route handler. Return `true` when it has written the response. */
  onRequest?: (req: IncomingMessage, res: ServerResponse) => boolean | Promise<boolean>;
}

function applyCors(req: IncomingMessage, res: ServerResponse, allowedOrigins: string[]): void {
  const origin = req.headers.origin;
  if (origin && (allowedOrigins.includes("*") || allowedOrigins.includes(origin))) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Credentials", "true");
  }
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Authorization, Content-Type, Sec-WebSocket-Protocol",
  );
}

/** Build the `(req, res)` listener implementing the security pipeline. */
export function createRequestListener(
  deps: HttpServerDeps,
): (req: IncomingMessage, res: ServerResponse) => void {
  const healthPath = deps.healthPath ?? HEALTH_PATH;
  const allowedOrigins = deps.allowedOrigins ?? [];
  const hostCheck = createHostChecker(deps.hostnames ?? []);

  return (req, res) => {
    void (async () => {
      const method = (req.method ?? "GET").toUpperCase();
      const path = (req.url ?? "/").split("?")[0];

      // (1) CORS preflight — exempt from host + auth.
      if (method === "OPTIONS") {
        applyCors(req, res, allowedOrigins);
        res.writeHead(204);
        res.end();
        return;
      }

      // (1) Health probe — exempt from host + auth.
      if (method === "GET" && path === healthPath) {
        applyCors(req, res, allowedOrigins);
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ status: "ok" }));
        return;
      }

      // (2) Host allowlist.
      if (!hostCheck(req.headers.host)) {
        res.writeHead(403, { "content-type": "text/plain" });
        res.end("Host not allowed");
        return;
      }

      // (3) CORS.
      applyCors(req, res, allowedOrigins);

      // (4) Auth (task-003).
      if (deps.authenticate && !deps.authenticate(req)) {
        res.writeHead(401, { "content-type": "text/plain" });
        res.end("Unauthorized");
        return;
      }

      // (5) Application routes.
      if (deps.onRequest) {
        const handled = await deps.onRequest(req, res);
        if (handled) return;
      }
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("Not found");
    })();
  };
}

/** Create (but do not start) the daemon HTTP server. */
export function createHttpServer(deps: HttpServerDeps = {}): Server {
  return createServer(createRequestListener(deps));
}
