import { startDaemon, type DaemonHandle, type DaemonOptions } from "./bootstrap.js";

/** The slice of `process` the entry uses: signal subscription and exit. Tests pass a fake. */
export interface ProcessHost {
  on(signal: "SIGINT" | "SIGTERM", listener: () => void): unknown;
  exit(code: number): void;
}

/**
 * Runs the daemon as the process's own: `startDaemon` plus everything only a process entry may do —
 * terminate on a fatal bind error, close and exit on SIGINT/SIGTERM, and exit after a self-update
 * has shut the daemon down. `daemon/main.ts` (the `pi-studio-daemon` bin) and the CLI's detached
 * `pi-studio daemon start` both call it; library embedders and tests call `startDaemon` instead, so
 * they never lose their host process.
 */
export function runDaemon(opts: DaemonOptions = {}, host: ProcessHost = process): DaemonHandle {
  const handle = startDaemon({
    // The process-level half of `startDaemon`'s fatal-error contract: the bootstrap logs the error
    // and tears down the WS server, but leaves terminating the process to its entry point.
    onFatalError: () => host.exit(1),
    // The update pipeline has shut the daemon down and started the restart helper, which waits for
    // this process to exit before it starts the new version: nothing else may run from here on.
    onUpdateRestart: (code) => host.exit(code),
    ...opts,
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
    `pi-studio daemon listening on ${url}`,
  );

  async function shutdown(): Promise<void> {
    log.info("shutting down");
    await handle.close();
    host.exit(0);
  }

  host.on("SIGINT", () => void shutdown());
  host.on("SIGTERM", () => void shutdown());
  return handle;
}
