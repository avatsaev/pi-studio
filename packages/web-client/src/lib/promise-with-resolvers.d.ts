/**
 * `Promise.withResolvers()` ambient augmentation. The runtime (all supported browsers + Bun)
 * implements ES2024's `Promise.withResolvers`, but this package's `tsconfig.json` targets
 * `lib: ["ES2023", "DOM", "DOM.Iterable"]`, which predates it — declare it here rather than
 * bumping the shared lib target.
 */

interface PromiseWithResolvers<T> {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
}

interface PromiseConstructor {
  withResolvers<T>(): PromiseWithResolvers<T>;
}
