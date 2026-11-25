import { spawn } from "node:child_process";

import treeKill from "tree-kill";

import type { Logger } from "../logging/logger.js";
import { settlesWithin } from "../util/settles-within.js";
import type { InstallSpawn, InstallSpawnResult } from "./sync-executor.js";

/**
 * The install children of one service: `pi install`, `pi update --extensions` and the `skills` CLI.
 * `spawn` is the production {@link InstallSpawn} seam; it keeps the live children in a registry so
 * `stop()` can end them when the daemon stops (features/self-update.md § Shutdown) — a daemon that
 * exits must leave no `npm` or `git` behind.
 */

/** What `spawn` rejects with once `stop()` ran, and what a service rejects its queued work with. */
export function shuttingDownError(): Error {
  return new Error("the daemon is shutting down");
}

/** A child's stdout is drained (an unread pipe would block it) but only this tail is kept. */
const STDOUT_TAIL_MAX = 16_384;
/** How long `stop()` waits for a child to exit after SIGTERM, then after SIGKILL. */
const STOP_GRACE_MS = 2_000;

/** One running child: its process tree can be signalled, and `exited` settles when it is gone. */
interface LiveInstall {
  kill(signal: NodeJS.Signals): void;
  exited: Promise<void>;
}

export interface InstallProcessesOptions {
  logger?: Logger;
  /** Overridable for tests; defaults to 2 s. */
  graceMs?: number;
}

export class InstallProcesses {
  private readonly live = new Set<LiveInstall>();
  private readonly logger: Logger | undefined;
  private readonly graceMs: number;
  private stopped = false;

  constructor(options: InstallProcessesOptions = {}) {
    this.logger = options.logger;
    this.graceMs = options.graceMs ?? STOP_GRACE_MS;
  }

  /** Spawns `command`, captures stderr (unbounded here — the executor bounds what it stores), and
   *  kills the whole process tree on timeout rather than just the direct child, so a `pi install`
   *  that itself forked a build/postinstall step doesn't linger. Rejects once `stop()` ran. */
  readonly spawn: InstallSpawn = async ({ command, env, timeoutMs, cwd }) => {
    if (this.stopped) throw shuttingDownError();
    const [bin, ...args] = command;
    const child = spawn(bin as string, args, { env, cwd, stdio: ["ignore", "pipe", "pipe"] });
    const result = Promise.withResolvers<InstallSpawnResult>();
    const exit = Promise.withResolvers<void>();
    const install: LiveInstall = {
      kill: (signal) => {
        if (child.pid !== undefined) treeKill(child.pid, signal, () => undefined);
        else child.kill(signal);
      },
      exited: exit.promise,
    };
    this.live.add(install);

    let stderr = "";
    let stdout = "";
    let timedOut = false;
    let settled = false;

    const timer = setTimeout(() => {
      timedOut = true;
      install.kill("SIGKILL");
    }, timeoutMs);
    const end = (): void => {
      settled = true;
      clearTimeout(timer);
      this.live.delete(install);
      exit.resolve();
    };

    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout = (stdout + chunk.toString("utf8")).slice(-STDOUT_TAIL_MAX);
    });

    child.on("error", (err) => {
      if (settled) return;
      end();
      result.reject(err);
    });

    child.on("exit", (code) => {
      if (settled) return;
      end();
      result.resolve({ exitCode: code, stderr, stdout, timedOut });
    });
    return result.promise;
  };

  /**
   * Refuse new children and end the live ones: SIGTERM to each process tree, then SIGKILL to those
   * still running after the grace. Resolves once they have exited (or the SIGKILL wait ran out).
   * Children started outside this seam (the update helper) are not touched.
   */
  async stop(): Promise<void> {
    this.stopped = true;
    await Promise.all([...this.live].map((install) => this.terminate(install)));
  }

  private async terminate(install: LiveInstall): Promise<void> {
    install.kill("SIGTERM");
    if (await settlesWithin(install.exited, this.graceMs)) return;
    this.logger?.warn("an install process ignored SIGTERM: killed");
    install.kill("SIGKILL");
    await settlesWithin(install.exited, this.graceMs);
  }
}
