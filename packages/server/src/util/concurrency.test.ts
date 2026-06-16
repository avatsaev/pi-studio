import { describe, expect, it } from "vitest";

import { createLimiter, mapWithConcurrency } from "./concurrency.js";

describe("mapWithConcurrency", () => {
  it("preserves input order in the result", async () => {
    const out = await mapWithConcurrency([1, 2, 3, 4], async (n) => n * 10, 2);
    expect(out).toEqual([10, 20, 30, 40]);
  });

  it("never exceeds the concurrency limit", async () => {
    let active = 0;
    let peak = 0;
    await mapWithConcurrency(
      Array.from({ length: 20 }, (_, i) => i),
      async () => {
        active++;
        peak = Math.max(peak, active);
        await new Promise((r) => setTimeout(r, 5));
        active--;
      },
      3,
    );
    expect(peak).toBeLessThanOrEqual(3);
    expect(peak).toBeGreaterThan(1);
  });

  it("returns empty for empty input without running fn", async () => {
    let calls = 0;
    const out = await mapWithConcurrency([], async () => {
      calls++;
      return 1;
    });
    expect(out).toEqual([]);
    expect(calls).toBe(0);
  });

  it("propagates rejections", async () => {
    await expect(
      mapWithConcurrency([1, 2, 3], async (n) => {
        if (n === 2) throw new Error("boom");
        return n;
      }),
    ).rejects.toThrow("boom");
  });

  it("createLimiter caps ad-hoc scheduling", async () => {
    const limit = createLimiter(1);
    const order: number[] = [];
    await Promise.all([
      limit(async () => {
        await new Promise((r) => setTimeout(r, 10));
        order.push(1);
      }),
      limit(async () => {
        order.push(2);
      }),
    ]);
    expect(order).toEqual([1, 2]); // serialized
  });
});
