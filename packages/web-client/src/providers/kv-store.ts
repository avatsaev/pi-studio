import { type KeyValueStore } from "@pi-studio-ui/theme/appearance-store.js";

// Web KeyValueStore backed by localStorage. In Electron a bridge-backed store
// can be substituted at the same DI boundary (ThemeBoundary `store` prop).
export const localKvStore: KeyValueStore = {
  get(key) {
    try {
      return globalThis.localStorage?.getItem(key) ?? null;
    } catch {
      return null;
    }
  },
  set(key, value) {
    try {
      globalThis.localStorage?.setItem(key, value);
    } catch {
      // Ignore quota / unavailable storage.
    }
  },
};
