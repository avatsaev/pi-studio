import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_VISIBLE_TOASTS, resetToastStoreForTests, useToastStore } from "./toast-store.js";
import { DEFAULT_TOAST_DURATION_MS } from "@pi-studio-ui/ui/toast.js";

beforeEach(() => {
  vi.useFakeTimers();
  resetToastStoreForTests();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("show / copied / error", () => {
  it("show renders an entry with the given content and options", () => {
    const id = useToastStore.getState().show("hello", { variant: "warning" });
    const entry = useToastStore.getState().toasts.find((t) => t.id === id);
    expect(entry?.content).toBe("hello");
    expect(entry?.variant).toBe("warning");
  });

  it("copied renders a success-variant entry", () => {
    useToastStore.getState().copied("Link copied");
    const entry = useToastStore.getState().toasts[0];
    expect(entry?.content).toBe("Link copied");
    expect(entry?.variant).toBe("success");
  });

  it("error renders an error-variant entry", () => {
    useToastStore.getState().error("Something broke");
    const entry = useToastStore.getState().toasts[0];
    expect(entry?.content).toBe("Something broke");
    expect(entry?.variant).toBe("error");
  });
});

describe("auto-dismiss", () => {
  it("auto-dismisses after the default duration", () => {
    useToastStore.getState().show("x");
    expect(useToastStore.getState().toasts).toHaveLength(1);
    vi.advanceTimersByTime(DEFAULT_TOAST_DURATION_MS - 1);
    expect(useToastStore.getState().toasts).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  it("a sticky toast (durationMs: null) never auto-dismisses", () => {
    useToastStore.getState().show("x", { durationMs: null });
    vi.advanceTimersByTime(1_000_000);
    expect(useToastStore.getState().toasts).toHaveLength(1);
  });

  it("dismiss removes a sticky toast on demand", () => {
    const id = useToastStore.getState().show("x", { durationMs: null });
    useToastStore.getState().dismiss(id);
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });
});

describe("hover-pause", () => {
  it("pausing freezes the remaining time; resuming continues it", () => {
    const id = useToastStore.getState().show("x", { durationMs: 1000 });
    vi.advanceTimersByTime(400); // 600ms remaining
    useToastStore.getState().pause(id);
    vi.advanceTimersByTime(10_000); // would have fired long ago if not paused
    expect(useToastStore.getState().toasts).toHaveLength(1);
    expect(useToastStore.getState().toasts[0]?.paused).toBe(true);

    useToastStore.getState().resume(id);
    expect(useToastStore.getState().toasts[0]?.paused).toBe(false);
    vi.advanceTimersByTime(599);
    expect(useToastStore.getState().toasts).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  it("pausing a sticky toast is a no-op (nothing to freeze)", () => {
    const id = useToastStore.getState().show("x", { durationMs: null });
    useToastStore.getState().pause(id);
    expect(useToastStore.getState().toasts[0]?.paused).toBe(false);
  });

  it("resuming a toast that was never paused is a no-op", () => {
    const id = useToastStore.getState().show("x");
    useToastStore.getState().resume(id);
    vi.advanceTimersByTime(DEFAULT_TOAST_DURATION_MS);
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });
});

describe("stacking (§ 11): at most MAX_VISIBLE_TOASTS visible", () => {
  it("a fourth toast queues rather than becoming immediately visible", () => {
    for (let i = 0; i < MAX_VISIBLE_TOASTS + 1; i++) useToastStore.getState().show(`t${i}`);
    expect(useToastStore.getState().toasts).toHaveLength(MAX_VISIBLE_TOASTS + 1);
  });

  it("a queued toast's timer does not start until it is promoted into a visible slot", () => {
    for (let i = 0; i < MAX_VISIBLE_TOASTS; i++) {
      useToastStore.getState().show(`t${i}`, { durationMs: 1000 });
    }
    // The 4th arrives after the first three have already been "running" a while.
    vi.advanceTimersByTime(900);
    useToastStore.getState().show("t-queued", { durationMs: 1000 });
    // If the queued toast's clock had started at show()-time bundled with the others, it would
    // already be near expiry; it must instead still have its full duration once visible.
    vi.advanceTimersByTime(100); // first three now expire (1000ms elapsed)
    const remaining = useToastStore.getState().toasts;
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.content).toBe("t-queued");
    // Freshly promoted — should still take its own full 1000ms from here, not 0.
    vi.advanceTimersByTime(999);
    expect(useToastStore.getState().toasts).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  it("dismissing a visible toast promotes the next queued one", () => {
    const ids: string[] = [];
    for (let i = 0; i < MAX_VISIBLE_TOASTS + 1; i++) {
      ids.push(useToastStore.getState().show(`t${i}`, { durationMs: null }));
    }
    expect(
      useToastStore
        .getState()
        .toasts.slice(0, MAX_VISIBLE_TOASTS)
        .map((t) => t.content),
    ).toEqual(["t0", "t1", "t2"]);
    useToastStore.getState().dismiss(ids[0]!);
    expect(
      useToastStore
        .getState()
        .toasts.slice(0, MAX_VISIBLE_TOASTS)
        .map((t) => t.content),
    ).toEqual(["t1", "t2", "t3"]);
  });
});

describe("dismissTop", () => {
  it("dismisses the oldest/topmost entry", () => {
    useToastStore.getState().show("first", { durationMs: null });
    useToastStore.getState().show("second", { durationMs: null });
    useToastStore.getState().dismissTop();
    expect(useToastStore.getState().toasts.map((t) => t.content)).toEqual(["second"]);
  });

  it("is a no-op with no toasts", () => {
    expect(() => useToastStore.getState().dismissTop()).not.toThrow();
  });
});
