#!/usr/bin/env node
/**
 * Dev daemon entry point — starts the full dev bootstrap (HTTP + WS + agent
 * services) for local development against the real app UI.
 */
import { createDaemonRuntimeInfo } from "./index.js";
import { startDevDaemon } from "./dev-bootstrap.js";

const info = createDaemonRuntimeInfo({
  mode: "development",
  listen: process.env.PI_STUDIO_LISTEN ?? "0.0.0.0:6767",
});

const hostnamesEnv = process.env.PI_STUDIO_HOSTNAMES;
const hostnames: true | string[] = hostnamesEnv
  ? hostnamesEnv.split(",").map((h) => h.trim())
  : true; // allow all in dev mode

const handle = startDevDaemon({
  host: info.listen.host,
  port: info.listen.port,
  serverId: process.env.PI_STUDIO_SERVER_ID,
  hostnames,
});

const log = handle.logger;
log.info(
  { listen: `http://${info.listen.host}:${info.listen.port}`, serverId: handle.serverId, provider: "mock" },
  `pi-studio dev daemon listening on http://${info.listen.host}:${info.listen.port}`,
);

process.on("SIGINT", async () => {
  log.info("shutting down");
  await handle.close();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  await handle.close();
  process.exit(0);
});
