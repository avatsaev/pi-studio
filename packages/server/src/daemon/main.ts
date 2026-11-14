#!/usr/bin/env node
/**
 * Production daemon entry point — starts the REAL daemon (real Pi provider, disk persistence, full
 * RPC surface). Listen address: `PI_STUDIO_LISTEN` → `config.json` `daemon.listen` → `127.0.0.1:6767`.
 */
import { startDaemon } from "./bootstrap.js";

const handle = startDaemon({
  // The process-level half of `startDaemon`'s fatal-error contract: the bootstrap logs the error
  // and tears down the WS server, but leaves terminating the process to its entry point.
  onFatalError: () => process.exit(1),
});

const log = handle.logger;
const url = `http://${handle.listen.host}:${handle.listen.port}`;
log.info(
  {
    listen: url,
    serverId: handle.serverId,
    home: handle.home,
    provider: handle.provider,
  },
  `pi-studio daemon listening on ${url}${handle.exposedWithoutPassword ? " (WARNING: no password set)" : ""}`,
);

async function shutdown(): Promise<void> {
  log.info("shutting down");
  await handle.close();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
