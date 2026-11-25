import { flushLogger } from "../logging/logger.js";
import { startDaemon, type DaemonHandle, type DaemonOptions } from "./bootstrap.js";
import { SHUTDOWN_DEADLINE_MS } from "./shutdown.js";

/** What the entry subscribes to on the process. */
export type ProcessEvent = "SIGINT" | "SIGTERM" | "uncaughtException" | "unhandledRejection";

/** The slice of `process` the entry uses: event subscription and exit. Tests pass a fake. */
export interface ProcessHost {
  on(event: ProcessEvent, listener: (arg: unknown) => void): unknown;
  exit(code: number): void;
}

/**
 * How long past the shutdown's own deadline a stuck stop (a hanging log flush, a shutdown that
 * never returns) gets before the process is ended with exit code 1.
 */
export const HARD_KILL_GRACE_MS = 2_000;

/** The error for the log: its message, and the stack when there is one. */
function describeError(error: unknown): { err: string; stack?: string } {
  return error instanceof Error
    ? { err: error.message, stack: error.stack }
    : { err: String(error) };
}

/**
 * Runs the daemon as the process's own: `startDaemon` plus everything only a process entry may do —
 * terminate on a fatal bind error, stop on SIGINT/SIGTERM and on an uncaught exception, survive an
 * unhandled rejection, and exit after a self-update has shut the daemon down. `daemon/main.ts` (the
 * `pi-studio-daemon` bin), the compiled binary and the CLI's detached `pi-studio daemon start` all
 * call it; library embedders and tests call `startDaemon` instead, so they never lose their host
 * process.
 *
 * One stop path serves every exit: the bounded shutdown (`handle.close()`), a flush of the log
 * file, then `exit`. The exit code is 0 after a signal and 1 after anything fatal, also when the
 * shutdown itself fails. A second signal exits 1 at once, and a timer of the shutdown deadline plus
 * {@link HARD_KILL_GRACE_MS} exits 1 when the stop has not finished.
 */
export function runDaemon(opts: DaemonOptions = {}, host: ProcessHost = process): DaemonHandle {
  let handle: DaemonHandle | undefined;
  let stopping = false;
  let exitCode = 0;
  let hardKill: NodeJS.Timeout | undefined;

  function exitNow(code: number): void {
    clearTimeout(hardKill);
    host.exit(code);
  }

  /** The shutdown, then the log flush, then the exit. Never rejects. */
  async function shutdownAndExit(daemon: DaemonHandle): Promise<void> {
    hardKill = setTimeout(() => {
      daemon.logger.error("shutdown did not finish in time: exiting");
      host.exit(1);
    }, SHUTDOWN_DEADLINE_MS + HARD_KILL_GRACE_MS);
    try {
      await daemon.close();
    } catch (err) {
      daemon.logger.error(describeError(err), "shutdown failed");
      exitCode = 1;
    }
    await flushLogger(daemon.logger);
    exitNow(exitCode);
  }

  /** The first call starts the stop; later ones only raise the exit code. */
  function stop(daemon: DaemonHandle, code: number): void {
    exitCode = Math.max(exitCode, code);
    if (stopping) return;
    stopping = true;
    void shutdownAndExit(daemon);
  }

  handle = startDaemon({
    // The process-level half of `startDaemon`'s fatal-error contract: the bootstrap logs the error
    // and shuts down (a listen failure), but leaves terminating the process to its entry point. A
    // failure while it is still starting up has no handle to stop: exit at once.
    onFatalError: () => (handle === undefined ? host.exit(1) : stop(handle, 1)),
    // The update pipeline has shut the daemon down and started the restart helper, which waits for
    // this process to exit before it starts the new version: nothing else may run from here on.
    onUpdateRestart: (code) => host.exit(code),
    ...opts,
  });

  const daemon = handle;
  const log = daemon.logger;
  const url = `http://${daemon.listen.host}:${daemon.listen.port}`;
  log.info(
    {
      listen: url,
      serverId: daemon.serverId,
      home: daemon.home,
      provider: daemon.provider,
    },
    `pi-studio daemon listening on ${url}`,
  );

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    host.on(signal, () => {
      if (stopping) {
        log.error({ signal }, "second signal during shutdown: exiting now");
        exitNow(1);
        return;
      }
      log.info({ signal }, "shutting down");
      stop(daemon, 0);
    });
  }

  host.on("uncaughtException", (error) => {
    log.fatal(describeError(error), "uncaught exception: shutting down");
    stop(daemon, 1);
  });

  // A stray rejection is a bug to find, not a reason to lose the agents: log it and keep running.
  host.on("unhandledRejection", (reason) => {
    log.error(describeError(reason), "unhandled rejection");
  });

  return daemon;
}
