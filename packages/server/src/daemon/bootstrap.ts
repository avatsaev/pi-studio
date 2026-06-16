import type { Server as HttpServer } from "node:http";
import { join } from "node:path";
import type { AddressInfo } from "node:net";

import { loadConfig } from "../config/daemon-config.js";
import { createDaemonLogger, type Logger } from "../logging/logger.js";
import { createPasswordAuth, resolvePasswordHash } from "../auth/password-auth.js";
import { createHostChecker } from "../http/host-allowlist.js";
import { createHttpServer } from "../http/http-server.js";
import { ensureDirectoryLayout } from "../persistence/atomic-store.js";
import { HandlerRegistry, routeBinaryFrame, routeTextFrame } from "../ws/router.js";
import { createWebSocketServer, type WebSocketServerHandle } from "../ws/ws-server.js";
import {
  acquirePidLock,
  loadOrCreateDaemonKeypair,
  loadOrCreateServerId,
  type PidLock,
  resolvePiStudioHome,
} from "./identity.js";

/**
 * Daemon bootstrap (architecture/daemon-bootstrap.md § Behavior, § Shutdown). Wires identity, config,
 * HTTP + WS servers, and the frame router, then listens. Feature handlers and the real AgentManager
 * register in later sprints; `agentMgr` is a stub here.
 */

type Env = Record<string, string | undefined>;

export const DEFAULT_LISTEN = "127.0.0.1:6767";

function parseListen(listen: string): { host: string; port: number } {
  const idx = listen.lastIndexOf(":");
  if (idx === -1) return { host: listen, port: 6767 };
  const host = listen.slice(0, idx) || "127.0.0.1";
  const port = Number(listen.slice(idx + 1));
  return { host, port: Number.isFinite(port) ? port : 6767 };
}

export interface DaemonHandle {
  readonly home: string;
  readonly serverId: string;
  readonly host: string;
  readonly port: number;
  readonly httpServer: HttpServer;
  readonly ws: WebSocketServerHandle;
  readonly registry: HandlerRegistry;
  readonly pidLock: PidLock;
  readonly logger: Logger;
  close(): Promise<void>;
}

export interface BootstrapOptions {
  env?: Env;
  /** Override the logger (tests pass a silent logger). */
  logger?: Logger;
}

export async function bootstrap(options: BootstrapOptions = {}): Promise<DaemonHandle> {
  const env = options.env ?? process.env;

  // Identity + layout.
  const home = resolvePiStudioHome(env);
  await ensureDirectoryLayout(home);
  const logger = (options.logger ?? createDaemonLogger(home)).child({ component: "daemon" });
  const config = loadConfig(join(home, "config.json"), env);
  const listen = parseListen(
    env.PI_STUDIO_LISTEN?.trim() || config.daemon.listen || DEFAULT_LISTEN,
  );

  const pidLock = acquirePidLock(join(home, "pi-studio.pid"), {
    listen: `${listen.host}:${listen.port}`,
  });
  const serverId = loadOrCreateServerId(home, env);
  loadOrCreateDaemonKeypair(home); // ensure keypair exists (relay uses it later)

  // AgentManager stub (real lifecycle lands in sprint-005).
  const agentMgr = { recover(): void {} };
  agentMgr.recover();

  // Security primitives.
  const auth = createPasswordAuth(
    resolvePasswordHash({
      configPassword: config.daemon.auth.password,
      envPassword: env.PI_STUDIO_PASSWORD,
    }),
  );
  const hostCheck = createHostChecker(config.daemon.hostnames);

  // HTTP + WS servers + router.
  const registry = new HandlerRegistry();
  const httpServer = createHttpServer({
    hostnames: config.daemon.hostnames,
    allowedOrigins: config.daemon.cors.allowedOrigins,
    authenticate: auth.enabled ? (req) => auth.authenticateHttp(req) : undefined,
  });

  const ws = createWebSocketServer(httpServer, {
    serverId,
    auth,
    hostCheck,
    onMessage: (session, frame) => {
      if ("text" in frame) void routeTextFrame(session, frame.text, registry);
      else routeBinaryFrame(session, frame.binary);
    },
  });

  await new Promise<void>((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(listen.port, listen.host, () => {
      httpServer.removeListener("error", reject);
      resolve();
    });
  });
  const port = (httpServer.address() as AddressInfo).port;
  logger.info({ serverId, host: listen.host, port, home }, "daemon listening");

  let closed = false;
  return {
    home,
    serverId,
    host: listen.host,
    port,
    httpServer,
    ws,
    registry,
    pidLock,
    logger,
    async close(): Promise<void> {
      if (closed) return;
      closed = true;
      logger.info("daemon shutting down");
      await ws.close(); // stop accepting + close sessions
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
      pidLock.release(); // release the PID lock
    },
  };
}
