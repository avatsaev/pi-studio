// Keyboard shortcut overrides store.
// features/keyboard-shortcuts.md § Customizable overrides
//
// In the production app this persists via AsyncStorage under the key below.
// In tests / Node environments the in-memory fallback is used.

export const OVERRIDES_STORAGE_KEY = "@pi-studio:keyboard-shortcut-overrides";

export type OverrideRecord = Record<string, string>; // bindingId → comboString

// ---------------------------------------------------------------------------
// In-memory overrides store (used in tests and SSR; production wraps AsyncStorage)
// ---------------------------------------------------------------------------

export class KeyboardShortcutOverridesStore {
  private _data: OverrideRecord;

  constructor(initial: OverrideRecord = {}) {
    this._data = { ...initial };
  }

  getAll(): Readonly<OverrideRecord> {
    return this._data;
  }

  get(bindingId: string): string | undefined {
    return this._data[bindingId];
  }

  set(bindingId: string, combo: string): void {
    this._data = { ...this._data, [bindingId]: combo };
  }

  remove(bindingId: string): void {
    const next = { ...this._data };
    delete next[bindingId];
    this._data = next;
  }

  resetAll(): void {
    this._data = {};
  }

  /** Serialize to a JSON string for AsyncStorage persistence. */
  serialize(): string {
    return JSON.stringify(this._data);
  }

  /** Hydrate from a JSON string (from AsyncStorage). */
  static deserialize(raw: string): KeyboardShortcutOverridesStore {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
        const safe: OverrideRecord = {};
        for (const [k, v] of Object.entries(parsed)) {
          if (typeof v === "string") safe[k] = v;
        }
        return new KeyboardShortcutOverridesStore(safe);
      }
    } catch {
      // Corrupt data: start fresh.
    }
    return new KeyboardShortcutOverridesStore();
  }
}
