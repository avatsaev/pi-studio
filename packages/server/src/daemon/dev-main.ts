#!/usr/bin/env node
/**
 * DEV daemon entrypoint — boots the daemon with ALL feature handlers wired (see dev-bootstrap.ts).
 * For local testing / the UI POC only; the production entry is `main.ts`.
 *
 *   node packages/server/dist/daemon/dev-main.js
 *
 * Defaults to binding 0.0.0.0 so the POC (or a phone) can connect over the LAN via the server's IP
 * (e.g. ?host=ws://192.168.1.20:6767). Override with PI_STUDIO_LISTEN=host:port.
 */
import { networkInterfaces } from "node:os";

import { devBootstrap } from "./dev-bootstrap.js";
import type { DevDaemonHandle } from "./dev-bootstrap.js";

/** Non-internal IPv4 addresses of this host, for printing reachable connect URLs. */
function lanAddresses(): string[] {
  const out: string[] = [];
  for (const addrs of Object.values(networkInterfaces())) {
    for (const a of addrs ?? []) {
      if (a.family === "IPv4" && !a.internal) out.push(a.address);
    }
  }
  return out;
}

async function main(): Promise<void> {
  // Dev daemon is meant to be reachable on the network; default to 0.0.0.0 unless told otherwise.
  if (!process.env.PI_STUDIO_LISTEN) process.env.PI_STUDIO_LISTEN = "0.0.0.0:6767";

  let handle: DevDaemonHandle;
  try {
    handle = await devBootstrap();
  } catch (error) {
    process.stderr.write(
      `failed to start dev daemon: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
    return;
  }

  handle.logger.info(
    { host: handle.host, port: handle.port },
    `Pi-Studio DEV daemon listening on ${handle.host}:${handle.port} (all features wired, bundled pi)`,
  );
  // Print ready-to-use connect URLs straight to stdout (the file logger isn't on the console).
  const hosts =
    handle.host === "0.0.0.0" || handle.host === "::"
      ? ["127.0.0.1", ...lanAddresses()]
      : [handle.host];
  process.stdout.write(
    `\nPi-Studio DEV daemon listening on ${handle.host}:${handle.port} (all features wired, bundled pi)\n`,
  );
  for (const h of hosts) {
    process.stdout.write(
      `  connect: ws://${h}:${handle.port}   POC: http://${h}:7070/?host=ws://${h}:${handle.port}&connect=1\n`,
    );
  }
  process.stdout.write("\n");

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
