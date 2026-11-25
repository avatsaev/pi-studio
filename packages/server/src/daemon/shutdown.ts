import type { Logger } from "../logging/logger.js";

/**
 * The daemon's shutdown runner (features/self-update.md § Shutdown). Both bootstraps list their
 * steps here instead of chaining awaits, so one failing or stuck step cannot skip the rest and the
 * whole stop has an end.
 */

/** The time the whole shutdown gets. A step still running at this point is abandoned. */
export const SHUTDOWN_DEADLINE_MS = 10_000;

export interface ShutdownStep {
  /** Names the step in the log: what failed, overran or was skipped. */
  name: string;
  /** Sync or async; a throw or a rejection fails the step only. */
  run: () => void | Promise<void>;
  /**
   * Run even when the deadline has passed (the PID file). Past the deadline the step is started and
   * not awaited, so it should finish synchronously.
   */
  always?: boolean;
}

/**
 * Run `steps` in order. A step that throws or rejects is logged with its name and the next one runs.
 * Every step is awaited until {@link SHUTDOWN_DEADLINE_MS} after the start: the step still pending
 * then is logged as overrun and abandoned, and the steps after it are skipped (logged), except the
 * `always` ones. Never rejects.
 */
export async function runShutdown(steps: readonly ShutdownStep[], logger: Logger): Promise<void> {
  const deadline = Promise.withResolvers<"overran">();
  const state = { expired: false };
  const timer = setTimeout(() => {
    state.expired = true;
    deadline.resolve("overran");
  }, SHUTDOWN_DEADLINE_MS);
  try {
    for (const step of steps) {
      if (state.expired && !step.always) {
        logger.warn({ step: step.name }, "shutdown step skipped: the deadline passed");
        continue;
      }
      const startedAt = Date.now();
      const running = runStep(step, logger);
      if (state.expired) continue; // an `always` step past the deadline: started, not awaited
      const outcome = await Promise.race([running, deadline.promise]);
      if (outcome === "overran") {
        logger.warn(
          { step: step.name, deadlineMs: SHUTDOWN_DEADLINE_MS },
          "shutdown step still running at the deadline: abandoned",
        );
      } else if (outcome === "done") {
        logger.debug({ step: step.name, durationMs: Date.now() - startedAt }, "shutdown step done");
      }
    }
  } finally {
    clearTimeout(timer);
  }
}

/** One step: `"done"` when it returned, `"failed"` when it threw (logged here). Never rejects. */
async function runStep(step: ShutdownStep, logger: Logger): Promise<"done" | "failed"> {
  try {
    await step.run();
    return "done";
  } catch (err) {
    logger.error(
      { step: step.name, err: err instanceof Error ? err.message : String(err) },
      "shutdown step failed",
    );
    return "failed";
  }
}
