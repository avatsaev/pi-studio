import { describe, it, expect, vi } from "vitest";
import {
  EMPTY_STREAM,
  appendDelta,
  applyStreamDelta,
  endStream,
  shouldShowCursor,
  createFrameBatcher,
  STREAM_CURSOR,
} from "./streaming.js";

describe("stream accumulation", () => {
  it("appendDelta concatenates and marks streaming", () => {
    let s = EMPTY_STREAM;
    s = appendDelta(s, "Hel");
    s = appendDelta(s, "lo");
    expect(s.text).toBe("Hello");
    expect(s.streaming).toBe(true);
  });

  it("applyStreamDelta supports delta and full-snapshot shapes", () => {
    expect(applyStreamDelta(EMPTY_STREAM, { delta: "a" }).text).toBe("a");
    expect(applyStreamDelta({ text: "x", streaming: true }, { text: "full" }).text).toBe("full");
    expect(applyStreamDelta({ text: "x", streaming: true }, {}).text).toBe("x");
  });

  it("endStream keeps text but stops streaming (cursor hidden)", () => {
    const s = endStream({ text: "done", streaming: true });
    expect(s).toEqual({ text: "done", streaming: false });
    expect(shouldShowCursor(s)).toBe(false);
    expect(shouldShowCursor({ streaming: true })).toBe(true);
  });

  it("exposes a cursor glyph", () => {
    expect(typeof STREAM_CURSOR).toBe("string");
    expect(STREAM_CURSOR.length).toBeGreaterThan(0);
  });
});

describe("createFrameBatcher (RAF coalescing)", () => {
  it("coalesces many pushes within one frame into a single flush with the latest value", () => {
    const flush = vi.fn();
    let scheduled: (() => void) | null = null;
    const schedule = (cb: () => void) => {
      scheduled = cb;
      return 1;
    };
    const cancel = vi.fn();
    const b = createFrameBatcher<number>(flush, schedule, cancel);

    for (let i = 0; i < 100; i++) b.push(i);
    expect(flush).not.toHaveBeenCalled(); // nothing until the frame fires

    scheduled!(); // frame boundary
    expect(flush).toHaveBeenCalledTimes(1);
    expect(flush).toHaveBeenCalledWith(99);
    expect(b.flushCount).toBe(1);
  });

  it("schedules a new frame after a flush for subsequent pushes", () => {
    const flush = vi.fn();
    const frames: (() => void)[] = [];
    const schedule = (cb: () => void) => {
      frames.push(cb);
      return frames.length;
    };
    const b = createFrameBatcher<string>(flush, schedule, () => {});

    b.push("a");
    frames[0]!();
    b.push("b");
    frames[1]!();

    expect(flush.mock.calls).toEqual([["a"], ["b"]]);
  });

  it("flushNow emits immediately and cancels the pending frame", () => {
    const flush = vi.fn();
    const cancel = vi.fn();
    const b = createFrameBatcher<number>(flush, () => 7, cancel);
    b.push(42);
    b.flushNow();
    expect(cancel).toHaveBeenCalledWith(7);
    expect(flush).toHaveBeenCalledWith(42);
  });

  it("cancel drops the pending value without flushing", () => {
    const flush = vi.fn();
    const frames: (() => void)[] = [];
    const b = createFrameBatcher<number>(flush, (cb) => {
      frames.push(cb);
      return 1;
    }, () => {});
    b.push(1);
    b.cancel();
    frames[0]?.();
    expect(flush).not.toHaveBeenCalled();
  });
});
