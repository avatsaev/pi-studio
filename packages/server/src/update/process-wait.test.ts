import { describe, expect, it } from "vitest";

import { processAlive, waitForProcessExit } from "./process-wait.js";

/** A fake clock: `sleep` advances `now`, and records each delay. */
function fakeClock(): {
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  sleeps: number[];
} {
  let t = 0;
  const sleeps: number[] = [];
  return {
    now: () => t,
    sleep: async (ms) => {
      sleeps.push(ms);
      t += ms;
    },
    sleeps,
  };
}

describe("waitForProcessExit", () => {
  it("resolves true at once when the process is already gone", async () => {
    const clock = fakeClock();
    const ok = await waitForProcessExit(1234, {
      timeoutMs: 1000,
      pollMs: 100,
      alive: () => false,
      ...clock,
    });
    expect(ok).toBe(true);
    expect(clock.sleeps).toEqual([]);
  });

  it("polls until the fake alive turns false", async () => {
    const clock = fakeClock();
    let polls = 0;
    const seen: number[] = [];
    const ok = await waitForProcessExit(77, {
      timeoutMs: 1000,
      pollMs: 100,
      alive: (pid) => (seen.push(pid), ++polls <= 3),
      ...clock,
    });
    expect(ok).toBe(true);
    expect(polls).toBe(4);
    expect(seen.every((p) => p === 77)).toBe(true);
    expect(clock.sleeps).toEqual([100, 100, 100]);
  });

  it("resolves false at the limit when the process never exits, without overshooting it", async () => {
    const clock = fakeClock();
    const ok = await waitForProcessExit(5, {
      timeoutMs: 250,
      pollMs: 100,
      alive: () => true,
      ...clock,
    });
    expect(ok).toBe(false);
    expect(clock.sleeps).toEqual([100, 100, 50]);
    expect(clock.now()).toBe(250);
  });

  it("timeoutMs 0 checks once and never sleeps", async () => {
    const clock = fakeClock();
    let polls = 0;
    const ok = await waitForProcessExit(5, {
      timeoutMs: 0,
      pollMs: 100,
      alive: () => (polls++, true),
      ...clock,
    });
    expect(ok).toBe(false);
    expect(polls).toBe(1);
    expect(clock.sleeps).toEqual([]);
  });
});

describe("processAlive", () => {
  it("is true for this process and false for a pid that cannot exist", () => {
    expect(processAlive(process.pid)).toBe(true);
    // Above the kernel's pid_max (2^22) on every supported OS.
    expect(processAlive(2 ** 31 - 2)).toBe(false);
  });
});
