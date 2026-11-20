// Polling, shared by every check.

/** Thrown from a `waitFor` probe to stop waiting at once: what is being waited for cannot happen. */
export class Abort extends Error {}

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Call `probe` until it returns something truthy, and return that. An error from the probe is
 * kept and tried again, except an `Abort`, which ends the wait. Rejects after `timeoutMs`, naming
 * `what` and the last error.
 */
export async function waitFor(what, probe, { timeoutMs = 10_000, intervalMs = 100 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  for (;;) {
    try {
      const value = await probe();
      if (value) return value;
    } catch (error) {
      if (error instanceof Abort) throw error;
      lastError = error;
    }
    if (Date.now() >= deadline) {
      const why = lastError ? ` (last error: ${lastError.message})` : "";
      throw new Error(`timed out after ${timeoutMs} ms waiting for ${what}${why}`);
    }
    await sleep(intervalMs);
  }
}
