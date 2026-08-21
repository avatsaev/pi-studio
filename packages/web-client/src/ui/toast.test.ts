import { describe, expect, it } from "vitest";
import {
  buildToastEntry,
  copiedToast,
  errorToast,
  remainingMs,
  toastTokens,
  DEFAULT_TOAST_DURATION_MS,
  EscStack,
  type ToastEntry,
} from "./toast.js";

describe("toastTokens", () => {
  it("carries no rail for default", () => {
    expect(toastTokens("default")).toEqual({});
  });

  it("maps success/error/warning to their status tokens", () => {
    expect(toastTokens("success")).toEqual({ token: "statusSuccess" });
    expect(toastTokens("error")).toEqual({ token: "statusDanger" });
    expect(toastTokens("warning")).toEqual({ token: "statusWarning" });
  });
});

describe("buildToastEntry", () => {
  it("defaults variant to 'default' and duration to DEFAULT_TOAST_DURATION_MS", () => {
    const built = buildToastEntry("t1", "hello", {}, 1000);
    expect(built).toEqual({
      id: "t1",
      content: "hello",
      variant: "default",
      durationMs: DEFAULT_TOAST_DURATION_MS,
      icon: undefined,
      paused: false,
      shownAt: 1000,
    });
  });

  it("preserves an explicit null durationMs (sticky)", () => {
    const built = buildToastEntry("t1", "hello", { durationMs: null }, 1000);
    expect(built.durationMs).toBeNull();
  });

  it("preserves an explicit variant/icon", () => {
    const built = buildToastEntry("t1", "hello", { variant: "warning", icon: "alert" }, 1000);
    expect(built.variant).toBe("warning");
    expect(built.icon).toBe("alert");
  });
});

describe("copiedToast / errorToast", () => {
  it("copiedToast defaults the label to 'Copied' and uses the success variant", () => {
    const { content, opts } = copiedToast();
    expect(content).toBe("Copied");
    expect(opts.variant).toBe("success");
    expect(opts.durationMs).toBe(DEFAULT_TOAST_DURATION_MS);
  });

  it("copiedToast accepts a custom label", () => {
    expect(copiedToast("Link copied").content).toBe("Link copied");
  });

  it("errorToast carries the message and the error variant", () => {
    const { content, opts } = errorToast("Something broke");
    expect(content).toBe("Something broke");
    expect(opts.variant).toBe("error");
  });
});

function entry(overrides: Partial<ToastEntry> = {}): ToastEntry {
  return {
    id: "t1",
    content: "x",
    variant: "default",
    durationMs: 2000,
    paused: false,
    shownAt: 1000,
    ...overrides,
  };
}

describe("remainingMs", () => {
  it("returns null for a sticky (durationMs: null) toast", () => {
    expect(remainingMs(entry({ durationMs: null }), null, 5000)).toBeNull();
  });

  it("computes elapsed time against shownAt", () => {
    expect(remainingMs(entry(), null, 1500)).toBe(1500); // 2000 - (1500 - 1000)
  });

  it("clamps to zero, never negative", () => {
    expect(remainingMs(entry(), null, 10_000)).toBe(0);
  });

  it("freezes at pausedRemaining while paused, ignoring elapsed time", () => {
    expect(remainingMs(entry({ paused: true }), 750, 999_999)).toBe(750);
  });

  it("ignores a null pausedRemaining even while paused (falls through to elapsed math)", () => {
    expect(remainingMs(entry({ paused: true }), null, 1500)).toBe(1500);
  });
});

describe("EscStack", () => {
  it("closes the topmost entry first", () => {
    const closed: string[] = [];
    const stack = new EscStack();
    stack.push("a", () => closed.push("a"));
    stack.push("b", () => closed.push("b"));
    expect(stack.closeTop()).toBe(true);
    expect(closed).toEqual(["b"]);
    expect(stack.closeTop()).toBe(true);
    expect(closed).toEqual(["b", "a"]);
  });

  it("returns false and closes nothing when empty", () => {
    expect(new EscStack().closeTop()).toBe(false);
  });

  it("pop removes a specific entry without closing it", () => {
    const closed: string[] = [];
    const stack = new EscStack();
    stack.push("a", () => closed.push("a"));
    stack.push("b", () => closed.push("b"));
    stack.pop("a");
    expect(stack.size).toBe(1);
    expect(stack.topId()).toBe("b");
    expect(closed).toEqual([]);
  });

  it("tracks size and topId", () => {
    const stack = new EscStack();
    expect(stack.size).toBe(0);
    expect(stack.topId()).toBeUndefined();
    stack.push("a", () => {});
    stack.push("b", () => {});
    expect(stack.size).toBe(2);
    expect(stack.topId()).toBe("b");
  });
});
