import { describe, expect, it } from "vitest";
import { createAppearanceController, type KeyValueStore } from "./appearance-store.js";

// sprint-053/task-001: nothing downstream of the controller can re-render on a theme change
// unless mutations notify subscribers. This is the plain-TypeScript contract ThemeBoundary's
// `useSyncExternalStore` relies on — verified here without any DOM/React involved.

function memoryStore(): KeyValueStore {
  const data = new Map<string, string>();
  return {
    get: (key) => data.get(key) ?? null,
    set: (key, value) => void data.set(key, value),
  };
}

describe("createAppearanceController subscribe/notify", () => {
  it("notifies subscribers on setMode", () => {
    const controller = createAppearanceController(memoryStore());
    let calls = 0;
    controller.subscribe(() => calls++);

    controller.setMode("light");

    expect(calls).toBe(1);
  });

  it("notifies subscribers on updateSettings", () => {
    const controller = createAppearanceController(memoryStore());
    let calls = 0;
    controller.subscribe(() => calls++);

    controller.updateSettings({ fontSize: 18 });

    expect(calls).toBe(1);
  });

  it("changes getState() identity so a snapshot-based subscriber sees a new value", () => {
    const controller = createAppearanceController(memoryStore());
    const before = controller.getState();

    controller.setMode("light");

    const after = controller.getState();
    expect(after).not.toBe(before);
    expect(after.resolvedTheme).not.toBe(before.resolvedTheme);
    expect(after.mode).toBe("light");
  });

  it("stops notifying once unsubscribed", () => {
    const controller = createAppearanceController(memoryStore());
    let calls = 0;
    const unsubscribe = controller.subscribe(() => calls++);

    controller.setMode("light");
    unsubscribe();
    controller.setMode("dark");

    expect(calls).toBe(1);
  });

  it("notifies every subscriber independently", () => {
    const controller = createAppearanceController(memoryStore());
    let a = 0;
    let b = 0;
    controller.subscribe(() => a++);
    controller.subscribe(() => b++);

    controller.updateSettings({ fontSize: 20 });

    expect(a).toBe(1);
    expect(b).toBe(1);
  });

  it("does not notify on apply() alone (no state mutation)", () => {
    const controller = createAppearanceController(memoryStore());
    let calls = 0;
    controller.subscribe(() => calls++);

    controller.apply();

    expect(calls).toBe(0);
  });
});

// sprint-089/task-002: the persisted key is configurable; the default must stay the key existing
// web-client installs already wrote, so upgrading the app keeps a user's theme/font settings.
function recordingStore(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  const reads: string[] = [];
  const writes: string[] = [];
  const store: KeyValueStore = {
    get: (key) => (reads.push(key), data.get(key) ?? null),
    set: (key, value) => (writes.push(key), void data.set(key, value)),
  };
  return { store, reads, writes };
}

describe("createAppearanceController storage key", () => {
  it("honours a value saved under the default key", () => {
    const { store } = recordingStore({
      "pi-studio-appearance": JSON.stringify({ mode: "light", settings: { fontSize: 18 } }),
    });

    const state = createAppearanceController(store).getState();

    expect(state.mode).toBe("light");
    expect(state.settings).toEqual({ fontSize: 18 });
  });

  it("neither reads nor writes the default key when a custom key is set", () => {
    const { store, reads, writes } = recordingStore({
      "pi-studio-appearance": JSON.stringify({ mode: "light", settings: {} }),
    });

    const controller = createAppearanceController(store, undefined, { storageKey: "other-app" });
    controller.setMode("dark");

    expect(controller.getState().mode).toBe("dark");
    expect(reads).toEqual(["other-app"]);
    expect(writes).toEqual(["other-app"]);
  });
});

// sprint-089/task-003: a cosmetic misconfiguration never blanks the app.
describe("createAppearanceController brandConfig", () => {
  const unbranded = createAppearanceController(memoryStore()).getState().resolvedTheme;

  it("brands the accent from a config with only colors.accent", () => {
    const theme = createAppearanceController(memoryStore(), {
      colors: { accent: "#ff0066" },
    }).getState().resolvedTheme;

    expect(theme.colors.accent).toBe("#ff0066");
    expect(theme.colors.surface).toBe(unbranded.colors.surface);
  });

  it("warns once and falls back to the unbranded theme on an invalid brandConfig", () => {
    const warnings: unknown[] = [];
    const original = console.warn;
    console.warn = (...args: unknown[]) => void warnings.push(args);
    try {
      const controller = createAppearanceController(memoryStore(), {
        colors: { accent: "blue" },
      });
      controller.setMode("light");
      controller.updateSettings({ fontSize: 15 });

      expect(warnings).toHaveLength(1);
      expect(String(warnings[0])).toContain("colors.accent");
      expect(controller.getState().resolvedTheme.colors.accent).not.toBe("blue");
    } finally {
      console.warn = original;
    }
  });
});
