#!/usr/bin/env node
/**
 * Production daemon entry point — starts the REAL daemon (real Pi provider, disk persistence, full
 * RPC surface). Binds `PI_STUDIO_LISTEN` (default `0.0.0.0:6767`).
 */
import { createDaemonRuntimeInfo } from "./index.js";
import { startDaemon } from "./bootstrap.js";

const info = createDaemonRuntimeInfo({
  mode: "production",
  listen: process.env.PI_STUDIO_LISTEN ?? "0.0.0.0:6767",
});

const handle = startDaemon({
  host: info.listen.host,
  port: info.listen.port,
  // The process-level half of `startDaemon`'s fatal-error contract: the bootstrap logs the error
  // and tears down the WS server, but leaves terminating the process to its entry point.
  onFatalError: () => process.exit(1),
});

const log = handle.logger;
log.info(
  {
    listen: `http://${info.listen.host}:${info.listen.port}`,
    serverId: handle.serverId,
    home: handle.home,
    provider: handle.provider,
  },
  `pi-studio daemon listening on http://${info.listen.host}:${info.listen.port}`,
);

async function shutdown(): Promise<void> {
  log.info("shutting down");
  await handle.close();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
