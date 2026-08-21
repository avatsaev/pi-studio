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
