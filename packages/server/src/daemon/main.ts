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
});

console.log(`pi-studio daemon listening on http://${info.listen.host}:${info.listen.port}`);
console.log(`  serverId: ${handle.serverId}`);
console.log(`  home:     ${handle.home}`);
console.log(`  provider: ${handle.provider}`);
console.log(`  ws: ready`);
console.log(`  Press Ctrl+C to stop`);

async function shutdown(): Promise<void> {
  console.log("\nShutting down...");
  await handle.close();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
