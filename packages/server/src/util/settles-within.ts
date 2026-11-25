/**
 * Whether `promise` settles (resolves or rejects) within `ms`: `true` once it does, `false` when the
 * time ran out first. Never rejects and leaves no timer behind. The stop paths use it to give a
 * process its grace between SIGTERM and SIGKILL.
 */
export async function settlesWithin(promise: Promise<unknown>, ms: number): Promise<boolean> {
  const { promise: timedOut, resolve } = Promise.withResolvers<false>();
  const timer = setTimeout(resolve, ms, false);
  try {
    return await Promise.race([
      promise.then(
        () => true,
        () => true,
      ),
      timedOut,
    ]);
  } finally {
    clearTimeout(timer);
  }
}
