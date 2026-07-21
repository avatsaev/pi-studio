#!/usr/bin/env node
/**
 * Process entry point for the standalone relay server (`bin: pi-studio-relay`). Reads
 * `PI_STUDIO_RELAY_LISTEN` (default `0.0.0.0:7000`) or `--listen host:port`, starts
 * `startRelayServer`, logs the bound address + health endpoint, and shuts down cleanly on
 * `SIGINT`/`SIGTERM`. This is what `pi-studio relay start` (packages/cli) spawns as a detached
 * child process, and what `npx @av-pi-studio/relay` runs directly for a foreground/manual deploy.
 *
 * Logging: structured pino to stdout always (pretty on a TTY, NDJSON otherwise — so `docker logs`
 * works out of the box); `PI_STUDIO_RELAY_LOG_LEVEL` sets the level (default `info`),
 * `PI_STUDIO_RELAY_LOG_DIR` additionally writes a rotating NDJSON file. Metadata only — the relay
 * never sees message contents, so nothing sensitive can be logged.
 */
import { startRelayServer } from "./relay-server.js";
import { createRelayLogger } from "./relay-logger.js";

const DEFAULT_LISTEN = "0.0.0.0:7000";

function parseListen(value: string): { host: string; port: number } {
  const idx = value.lastIndexOf(":");
  if (idx <= 0) throw new Error(`invalid --listen value: ${JSON.stringify(value)} (expected host:port)`);
  const host = value.slice(0, idx);
  const port = Number(value.slice(idx + 1));
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`invalid port in --listen value: ${JSON.stringify(value)}`);
  }
  return { host, port };
}

function resolveListen(argv: string[]): string {
  const flagIndex = argv.indexOf("--listen");
  if (flagIndex !== -1 && argv[flagIndex + 1]) return argv[flagIndex + 1]!;
  return process.env.PI_STUDIO_RELAY_LISTEN ?? DEFAULT_LISTEN;
}

async function main(): Promise<void> {
  const { host, port } = parseListen(resolveListen(process.argv.slice(2)));
  const log = createRelayLogger();
  const handle = await startRelayServer({ host, port, logger: log });

  log.info({ host: handle.host, port: handle.port }, `listening on ws://${handle.host}:${handle.port} (health: /health)`);

  const shutdown = (): void => {
    log.info("shutting down");
    void handle.close().then(() => process.exit(0));
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err: unknown) => {
  createRelayLogger().fatal({ err: (err as Error)?.message ?? String(err) }, "fatal");
  process.exit(1);
});
