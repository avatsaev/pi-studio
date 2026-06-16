#!/usr/bin/env node
/**
 * Pi-Studio daemon entrypoint (architecture/daemon-bootstrap.md). Boots the daemon from the current
 * environment (`$PI_STUDIO_HOME`, `$PI_STUDIO_LISTEN`, `$PI_STUDIO_PASSWORD`, …), then runs until it
 * receives SIGINT/SIGTERM, at which point it shuts down cleanly (releases the PID lock, closes the
 * HTTP/WS servers).
 *
 * Run it directly once the workspace is built:
 *   node packages/server/dist/daemon/main.js
 * or via the package bin:
 *   pi-studio-daemon
 */
import { bootstrap, type DaemonHandle } from "./bootstrap.js";

async function main(): Promise<void> {
  let handle: DaemonHandle;
  try {
    handle = await bootstrap();
  } catch (error) {
    process.stderr.write(
      `failed to start daemon: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
    return;
  }

  handle.logger.info(
    { host: handle.host, port: handle.port },
    `Pi-Studio daemon listening on ${handle.host}:${handle.port}`,
  );

  let shuttingDown = false;
  const shutdown = (signal: NodeJS.Signals): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    handle.logger.info({ signal }, "shutting down");
    void handle.close().then(
      () => process.exit(0),
      () => process.exit(1),
    );
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

void main();
