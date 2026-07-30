import { describe, expect, it } from "vitest";

import { nextFreeSlot, SLOT_SPACE } from "./slots.js";

describe("nextFreeSlot", () => {
  it("hands out the cursor position when it is free", () => {
    expect(nextFreeSlot(new Map(), 7)).toBe(7);
  });

  it("skips live ids and wraps around the end of the one-byte space", () => {
    const live = new Set([254, 255, 0, 1]);
    expect(nextFreeSlot(live, 254)).toBe(2);
  });

  it("reuses a released id rather than growing past the space", () => {
    const live = new Set(Array.from({ length: SLOT_SPACE }, (_, i) => i));
    live.delete(42);
    expect(nextFreeSlot(live, 100)).toBe(42);
  });

  it("returns null only when every id is live", () => {
    const live = new Set(Array.from({ length: SLOT_SPACE }, (_, i) => i));
    expect(nextFreeSlot(live, 0)).toBeNull();
  });

  it("normalizes an out-of-range cursor instead of scanning outside the space", () => {
    expect(nextFreeSlot(new Map(), SLOT_SPACE + 3)).toBe(3);
    expect(nextFreeSlot(new Map(), -1)).toBe(255);
  });

  it("never returns an id the frame codecs would reject", () => {
    // Rotating through more ids than the space holds must stay in range — the exact failure
    // (`stream must be an integer 0–255`) a bare `next++` allocator produced on hand-out 256.
    const live = new Map<number, true>();
    let cursor = 1;
    for (let i = 0; i < SLOT_SPACE * 3; i++) {
      const slot = nextFreeSlot(live, cursor);
      expect(slot).not.toBeNull();
      expect(slot).toBeGreaterThanOrEqual(0);
      expect(slot).toBeLessThan(SLOT_SPACE);
      cursor = (slot! + 1) % SLOT_SPACE;
    }
  });
});
