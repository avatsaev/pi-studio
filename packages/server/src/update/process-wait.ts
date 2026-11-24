/**
 * Waiting for a process to exit (features/self-update.md § CLI, D15/P13). Pure of the CLI and the
 * daemon: it only polls `process.kill(pid, 0)`, with every side effect injectable.
 */

export interface WaitForProcessExitOptions {
  /** How long to wait; `0` checks once. */
  timeoutMs: number;
  /** Delay between two checks. */
  pollMs: number;
  /** Whether the process still exists. Default: signal 0 (`EPERM` counts as alive). */
  alive?: (pid: number) => boolean;
  /** Default: `setTimeout`. */
  sleep?: (ms: number) => Promise<void>;
  /** Default: `Date.now`. */
  now?: () => number;
}

/** Signal 0 probe: gone (`ESRCH`) is the only "not alive" answer; `EPERM` means it exists. */
export function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** Resolves `true` once `pid` is gone, `false` when it still exists after `timeoutMs`. */
export async function waitForProcessExit(
  pid: number,
  opts: WaitForProcessExitOptions,
): Promise<boolean> {
  const alive = opts.alive ?? processAlive;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = opts.now ?? Date.now;
  const deadline = now() + opts.timeoutMs;
  for (;;) {
    if (!alive(pid)) return true;
    const remaining = deadline - now();
    if (remaining <= 0) return false;
    await sleep(Math.min(opts.pollMs, remaining));
  }
}
