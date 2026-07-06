/**
 * Tests for overlay infrastructure — pure logic only (no DOM/JSX).
 * ui-components.md § Overlays, § Feedback
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  resolveOverlayMode,
  Z_ORDER,
  toastQueueReducer,
  newToastId,
  EscStack,
  buildToastEntry,
  copiedToast,
  errorToast,
  remainingMs,
  DEFAULT_TOAST_DURATION_MS,
  type ToastQueueAction,
} from "./overlays-logic.js";

// ---------------------------------------------------------------------------
// Overlay mode resolution
// ---------------------------------------------------------------------------
describe("resolveOverlayMode", () => {
  it("compact → bottom-sheet", () => {
    expect(resolveOverlayMode(true)).toBe("bottom-sheet");
  });
  it("non-compact → anchored", () => {
    expect(resolveOverlayMode(false)).toBe("anchored");
  });
});

describe("Z_ORDER", () => {
  it("modal < toast", () => {
    expect(Z_ORDER.modal).toBeLessThan(Z_ORDER.toast);
  });
  it("modal = 100, toast = 200", () => {
    expect(Z_ORDER.modal).toBe(100);
    expect(Z_ORDER.toast).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Toast queue reducer
// ---------------------------------------------------------------------------
describe("toastQueueReducer", () => {
  it("add enqueues a toast", () => {
    const q = toastQueueReducer([], { type: "add", id: "t1", content: "Hello", opts: {} }, 1000);
    expect(q).toHaveLength(1);
    expect(q[0]!.content).toBe("Hello");
    expect(q[0]!.id).toBe("t1");
    expect(q[0]!.variant).toBe("default");
  });

  it("dismiss removes the matching toast", () => {
    let q = toastQueueReducer([], { type: "add", id: "t1", content: "A", opts: {} }, 1000);
    q = toastQueueReducer(q, { type: "dismiss", id: "t1" });
    expect(q).toHaveLength(0);
  });

  it("dismiss unknown id leaves queue unchanged", () => {
    let q = toastQueueReducer([], { type: "add", id: "t1", content: "A", opts: {} });
    q = toastQueueReducer(q, { type: "dismiss", id: "unknown" });
    expect(q).toHaveLength(1);
  });

  it("pause marks toast.paused=true", () => {
    let q = toastQueueReducer([], { type: "add", id: "t1", content: "A", opts: {} });
    q = toastQueueReducer(q, { type: "pause", id: "t1" });
    expect(q[0]!.paused).toBe(true);
  });

  it("resume marks toast.paused=false", () => {
    let q = toastQueueReducer([], { type: "add", id: "t1", content: "A", opts: {} });
    q = toastQueueReducer(q, { type: "pause", id: "t1" });
    q = toastQueueReducer(q, { type: "resume", id: "t1" });
    expect(q[0]!.paused).toBe(false);
  });

  it("multiple toasts maintain order", () => {
    let q = toastQueueReducer([], { type: "add", id: "t1", content: "A", opts: {} });
    q = toastQueueReducer(q, { type: "add", id: "t2", content: "B", opts: {} });
    q = toastQueueReducer(q, { type: "add", id: "t3", content: "C", opts: {} });
    expect(q.map((e) => e.id)).toEqual(["t1", "t2", "t3"]);
    q = toastQueueReducer(q, { type: "dismiss", id: "t2" });
    expect(q.map((e) => e.id)).toEqual(["t1", "t3"]);
  });

  it("add with null durationMs → sticky", () => {
    const q = toastQueueReducer([], { type: "add", id: "t1", content: "Sticky", opts: { durationMs: null } });
    expect(q[0]!.durationMs).toBe(null);
  });
});

// ---------------------------------------------------------------------------
// EscStack
// ---------------------------------------------------------------------------
describe("EscStack", () => {
  let stack: EscStack;

  beforeEach(() => {
    stack = new EscStack();
  });

  it("starts empty", () => {
    expect(stack.size).toBe(0);
    expect(stack.topId()).toBeUndefined();
  });

  it("push / topId", () => {
    stack.push("a", () => {});
    stack.push("b", () => {});
    expect(stack.topId()).toBe("b");
    expect(stack.size).toBe(2);
  });

  it("closeTop closes and removes the top entry", () => {
    const calls: string[] = [];
    stack.push("a", () => calls.push("a"));
    stack.push("b", () => calls.push("b"));
    const closed = stack.closeTop();
    expect(closed).toBe(true);
    expect(calls).toEqual(["b"]);
    expect(stack.size).toBe(1);
    expect(stack.topId()).toBe("a");
  });

  it("closeTop on empty returns false", () => {
    expect(stack.closeTop()).toBe(false);
  });

  it("pop removes a specific entry", () => {
    stack.push("a", () => {});
    stack.push("b", () => {});
    stack.pop("a");
    expect(stack.size).toBe(1);
    expect(stack.topId()).toBe("b");
  });
});

// ---------------------------------------------------------------------------
// remainingMs
// ---------------------------------------------------------------------------
describe("remainingMs", () => {
  it("null durationMs → null (sticky)", () => {
    const entry = buildToastEntry("s", "sticky", { durationMs: null }, 1000);
    expect(remainingMs(entry, null, 2000)).toBeNull();
  });

  it("calculates remaining time correctly", () => {
    const entry = buildToastEntry("t", "hello", { durationMs: 2200 }, 1000);
    expect(remainingMs(entry, null, 1200)).toBe(2000);
    expect(remainingMs(entry, null, 3200)).toBe(0); // clamped at 0
  });

  it("paused: returns frozen remaining", () => {
    const entry = buildToastEntry("p", "paused", { durationMs: 2200 }, 1000);
    const paused = { ...entry, paused: true };
    expect(remainingMs(paused, 1500, 5000)).toBe(1500);
  });
});
