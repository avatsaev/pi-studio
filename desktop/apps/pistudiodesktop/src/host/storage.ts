import { type KeyValueStore } from "@av-pi-studio/ui-library";

/** The workbench's storage over a boot snapshot, written through to Rust. */
export interface DesktopStorage extends KeyValueStore {
  /** Resolves when every `storage_set` sent so far has been answered. Never rejects. */
  settled(): Promise<void>;
}

/**
 * `get` reads memory; `set` updates memory and sends without waiting. A rejected send is logged and
 * never thrown (a `KeyValueStore` is synchronous and never throws).
 */
export function createDesktopStorage(
  snapshot: Readonly<Record<string, string>>,
  send: (key: string, value: string) => Promise<unknown>,
  log: (message: string, error: unknown) => void,
): DesktopStorage {
  const values = new Map(Object.entries(snapshot));
  const pending = new Set<Promise<void>>();
  return {
    get: (key) => values.get(key) ?? null,
    set(key, value) {
      values.set(key, value);
      let sent: Promise<unknown>;
      try {
        sent = send(key, value);
      } catch (error) {
        sent = Promise.reject(error);
      }
      const done: Promise<void> = sent.then(
        () => undefined,
        (error: unknown) => log(`storage_set failed for "${key}"`, error),
      ).finally(() => pending.delete(done));
      pending.add(done);
    },
    async settled() {
      await Promise.all(pending);
    },
  };
}
