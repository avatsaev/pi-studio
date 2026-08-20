/**
 * `Promise.withResolvers()` ambient augmentation. The runtime (Node 22+) implements ES2024's
 * `Promise.withResolvers`, but this package's `tsconfig.json` (via `tsconfig.base.json`) targets
 * `lib: ["ES2023"]`, which predates it — declare it here rather than bumping the shared lib target
 * (same pattern as `packages/cli/src/promise-with-resolvers.d.ts` /
 * `packages/web-client/src/lib/promise-with-resolvers.d.ts`).
 */

interface PromiseWithResolvers<T> {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
}

interface PromiseConstructor {
  withResolvers<T>(): PromiseWithResolvers<T>;
}
