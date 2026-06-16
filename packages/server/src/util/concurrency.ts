import pLimit from "p-limit";

/**
 * Bounded-concurrency helpers (adopted `p-limit`). Use these wherever the daemon fans out concurrent
 * I/O — multi-workspace git status, provider-snapshot batch refresh, bulk archive cascade — so a
 * large workspace set can't open hundreds of simultaneous git/fs operations.
 */

/** Default fan-out cap for filesystem / subprocess heavy work. */
export const DEFAULT_CONCURRENCY = 8;

/**
 * Map `items` through `fn` with at most `limit` running at once, preserving input order in the
 * result. Rejections propagate (like `Promise.all`).
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  fn: (item: T, index: number) => Promise<R>,
  limit: number = DEFAULT_CONCURRENCY,
): Promise<R[]> {
  if (items.length === 0) return [];
  const run = pLimit(Math.max(1, limit));
  return Promise.all(items.map((item, index) => run(() => fn(item, index))));
}

/** A reusable limiter for ad-hoc scheduling. */
export function createLimiter(limit: number = DEFAULT_CONCURRENCY): ReturnType<typeof pLimit> {
  return pLimit(Math.max(1, limit));
}
