/**
 * KeyValueStore interface + web (localStorage) implementation.
 * client-app-runtime.md § Data & Persistence
 */

export interface KeyValueStore {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
}

/**
 * Web localStorage implementation.
 * Falls back to in-memory if localStorage is unavailable (SSR / iframe sandbox).
 */
export function createWebKVStore(): KeyValueStore {
  const fallback = new Map<string, string>();
  const useFallback = !hasLocalStorage();

  return {
    get(key) {
      if (useFallback) return fallback.get(key) ?? null;
      try {
        return localStorage.getItem(key);
      } catch {
        return fallback.get(key) ?? null;
      }
    },
    set(key, value) {
      if (useFallback) {
        fallback.set(key, value);
        return;
      }
      try {
        localStorage.setItem(key, value);
      } catch {
        fallback.set(key, value);
      }
    },
    remove(key) {
      if (useFallback) {
        fallback.delete(key);
        return;
      }
      try {
        localStorage.removeItem(key);
      } catch {
        fallback.delete(key);
      }
    },
  };
}

function hasLocalStorage(): boolean {
  try {
    const test = "__pi_kv_test__";
    localStorage.setItem(test, "1");
    localStorage.removeItem(test);
    return true;
  } catch {
    return false;
  }
}

/**
 * In-memory KV store for testing.
 */
export function createMemoryKVStore(): KeyValueStore {
  const data = new Map<string, string>();
  return {
    get(key) {
      return data.get(key) ?? null;
    },
    set(key, value) {
      data.set(key, value);
    },
    remove(key) {
      data.delete(key);
    },
  };
}
