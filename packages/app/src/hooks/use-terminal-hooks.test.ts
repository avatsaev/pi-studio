/**
 * Terminal stream controller tests — sprint-023 / task-003
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  dedupResize,
  createTerminalController,
  TerminalSessionRegistry,
  createDebouncedResize,
} from "./use-terminal-hooks.js";

// ─── dedupResize ──────────────────────────────────────────────────────────────

describe("dedupResize", () => {
  it("returns true when no previous size (first resize)", () => {
    expect(dedupResize(undefined, 80, 24)).toBe(true);
  });

  it("returns false when cols and rows are unchanged", () => {
    expect(dedupResize({ cols: 80, rows: 24 }, 80, 24)).toBe(false);
  });

  it("returns true when cols change", () => {
    expect(dedupResize({ cols: 80, rows: 24 }, 100, 24)).toBe(true);
  });

  it("returns true when rows change", () => {
    expect(dedupResize({ cols: 80, rows: 24 }, 80, 30)).toBe(true);
  });

  it("returns true when both change", () => {
    expect(dedupResize({ cols: 80, rows: 24 }, 100, 30)).toBe(true);
  });
});

// ─── createTerminalController ─────────────────────────────────────────────────

describe("createTerminalController", () => {
  function makeRouter() {
    const subscribeSlot = vi.fn((_slot: number, sub: { onOutput?: (d: Uint8Array) => void; onSnapshot?: (d: Uint8Array) => void; onRestore?: (d: Uint8Array) => void }) => {
      return () => {};
    });
    const sendInput = vi.fn();
    const sendResize = vi.fn();
    return { subscribeSlot, sendInput, sendResize };
  }

  it("subscribes to slot on subscribe()", () => {
    const router = makeRouter();
    const onOutput = vi.fn();
    const onSnapshot = vi.fn();
    const ctrl = createTerminalController({ router: router as never, slot: 3, onOutput, onSnapshot });
    ctrl.subscribe();
    expect(router.subscribeSlot).toHaveBeenCalledWith(3, expect.any(Object));
  });

  it("subscribe is idempotent (only subscribes once)", () => {
    const router = makeRouter();
    const ctrl = createTerminalController({
      router: router as never,
      slot: 3,
      onOutput: vi.fn(),
      onSnapshot: vi.fn(),
    });
    ctrl.subscribe();
    ctrl.subscribe();
    expect(router.subscribeSlot).toHaveBeenCalledTimes(1);
  });

  it("writeInput calls router.sendInput with correct slot and data", () => {
    const router = makeRouter();
    const ctrl = createTerminalController({
      router: router as never,
      slot: 5,
      onOutput: vi.fn(),
      onSnapshot: vi.fn(),
    });
    const data = new Uint8Array([72, 101, 108, 108, 111]);
    ctrl.writeInput(data);
    expect(router.sendInput).toHaveBeenCalledWith(5, data);
  });

  it("resize sends and returns true on first call (no previous)", () => {
    const router = makeRouter();
    const ctrl = createTerminalController({
      router: router as never,
      slot: 1,
      onOutput: vi.fn(),
      onSnapshot: vi.fn(),
    });
    const sent = ctrl.resize(80, 24);
    expect(sent).toBe(true);
    expect(router.sendResize).toHaveBeenCalledWith(1, 24, 80);
  });

  it("resize returns false when dimensions unchanged", () => {
    const router = makeRouter();
    const ctrl = createTerminalController({
      router: router as never,
      slot: 1,
      onOutput: vi.fn(),
      onSnapshot: vi.fn(),
    });
    ctrl.resize(80, 24);
    const sent = ctrl.resize(80, 24);
    expect(sent).toBe(false);
    expect(router.sendResize).toHaveBeenCalledTimes(1);
  });

  it("snapshotRestored starts false and becomes true after snapshot", () => {
    let snapSub: { onSnapshot?: (d: Uint8Array) => void } = {};
    const router = {
      subscribeSlot: vi.fn((_slot: number, sub: typeof snapSub) => {
        snapSub = sub;
        return () => {};
      }),
      sendInput: vi.fn(),
      sendResize: vi.fn(),
    };
    const ctrl = createTerminalController({
      router: router as never,
      slot: 2,
      onOutput: vi.fn(),
      onSnapshot: vi.fn(),
    });
    ctrl.subscribe();
    expect(ctrl.snapshotRestored).toBe(false);
    snapSub.onSnapshot?.(new Uint8Array([1, 2, 3]));
    expect(ctrl.snapshotRestored).toBe(true);
  });
});

// ─── TerminalSessionRegistry ──────────────────────────────────────────────────

describe("TerminalSessionRegistry", () => {
  function makeFactory(slot = 0) {
    return (_id: string) => ({
      slot,
      controller: {
        snapshotRestored: false,
        subscribe: () => () => {},
        writeInput: vi.fn(),
        resize: vi.fn(() => true),
      },
    });
  }

  it("creates a new session on first acquire", () => {
    const reg = new TerminalSessionRegistry();
    const { session } = reg.acquire("t1", makeFactory(1));
    expect(session.terminalId).toBe("t1");
    expect(session.slot).toBe(1);
    expect(session.refs).toBe(1);
    reg.clear();
  });

  it("increments refs on repeated acquire of same terminal", () => {
    const reg = new TerminalSessionRegistry();
    reg.acquire("t1", makeFactory(1));
    const { session } = reg.acquire("t1", makeFactory(1));
    expect(session.refs).toBe(2);
    reg.clear();
  });

  it("decrements refs on release", () => {
    const reg = new TerminalSessionRegistry();
    const { session, release } = reg.acquire("t1", makeFactory(1));
    release();
    // session still exists (eviction timer started, not yet expired)
    expect(reg.peek("t1")).toBeDefined();
    reg.clear();
  });

  it("peek returns undefined for unknown terminal", () => {
    const reg = new TerminalSessionRegistry();
    expect(reg.peek("nonexistent")).toBeUndefined();
  });

  it("clear removes all sessions", () => {
    const reg = new TerminalSessionRegistry();
    reg.acquire("t1", makeFactory(1));
    reg.acquire("t2", makeFactory(2));
    reg.clear();
    expect(reg.size).toBe(0);
  });
});

// ─── createDebouncedResize ────────────────────────────────────────────────────

describe("createDebouncedResize", () => {
  it("coalesces rapid resizes and sends only the last one", async () => {
    const resize = vi.fn(() => true);
    const mockCtrl = { resize, snapshotRestored: false, subscribe: vi.fn(), writeInput: vi.fn() };
    const debounced = createDebouncedResize(mockCtrl, 10);

    debounced(80, 24);
    debounced(90, 30);
    debounced(100, 40);

    // None sent yet (within debounce window)
    expect(resize).not.toHaveBeenCalled();

    // Wait for debounce
    await new Promise((r) => setTimeout(r, 20));
    expect(resize).toHaveBeenCalledTimes(1);
    expect(resize).toHaveBeenCalledWith(100, 40);
  });
});
