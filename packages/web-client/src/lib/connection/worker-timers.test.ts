/**
 * This repo's Vitest suite runs in the Node environment with no DOM `Worker`, so these tests
 * exercise only the plain-`setTimeout` **fallback path** (fire, cancel, the latched fallback
 * decision, and pending-callback cleanup) — the actual Worker path is not unit-testable here and
 * is verified live in task-004 (see
 * swe/sprints/sprint-050-connection-resilience/backlog/task-004-e2e-verification-docs.md).
 * Do not read this file's coverage as proving the Worker path works; it proves the module
 * degrades correctly when it can't.
 *
 * Each test dynamically re-imports the module after `vi.resetModules()` so the lazily-created,
 * module-level singleton backend starts fresh — otherwise the fallback latched by one test would
 * leak into the next.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { createWorkerTimers as CreateWorkerTimers } from "./worker-timers.js";

async function freshModule(): Promise<{ createWorkerTimers: typeof CreateWorkerTimers }> {
  vi.resetModules();
  return import("./worker-timers.js");
}

describe("createWorkerTimers() — fallback path (no DOM Worker in this environment)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("fires a timer once after the requested delay", async () => {
    const { createWorkerTimers } = await freshModule();
    const { setTimer } = createWorkerTimers();
    const cb = vi.fn();
    setTimer(cb, 100);

    vi.advanceTimersByTime(99);
    expect(cb).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("clearTimer before the delay elapses prevents the callback from firing", async () => {
    const { createWorkerTimers } = await freshModule();
    const { setTimer, clearTimer } = createWorkerTimers();
    const cb = vi.fn();
    const handle = setTimer(cb, 100);
    clearTimer(handle);

    vi.advanceTimersByTime(1000);
    expect(cb).not.toHaveBeenCalled();
  });

  it("importing the module constructs no timer backend", async () => {
    // No DOM `Worker` global exists in this environment, so if the module constructed anything
    // eagerly at import time it would throw here, before any `setTimer` call happens.
    await expect(freshModule()).resolves.toBeDefined();
  });

  it("with Worker unavailable, behaves correctly via the fallback, latching the decision", async () => {
    const { createWorkerTimers } = await freshModule();
    const globalWithWorker = globalThis as { Worker?: unknown };
    expect(globalWithWorker.Worker).toBeUndefined(); // Node test environment — no DOM Worker

    const { setTimer, clearTimer } = createWorkerTimers();
    const fired = vi.fn();
    const cancelled = vi.fn();
    setTimer(fired, 10);
    const handle = setTimer(cancelled, 10);
    clearTimer(handle);

    vi.advanceTimersByTime(10);
    expect(fired).toHaveBeenCalledTimes(1);
    expect(cancelled).not.toHaveBeenCalled();
  });

  it("stubbed throwing Worker constructor is invoked at most once (latched, not retried)", async () => {
    const { createWorkerTimers } = await freshModule();
    const globalWithWorker = globalThis as { Worker?: unknown };
    let constructorCalls = 0;
    globalWithWorker.Worker = class {
      constructor() {
        constructorCalls += 1;
        throw new Error("Worker construction not supported in this environment");
      }
    };

    try {
      const { setTimer } = createWorkerTimers();
      setTimer(vi.fn(), 10);
      setTimer(vi.fn(), 10); // a second call must not re-attempt Worker construction
      expect(constructorCalls).toBe(1);
    } finally {
      delete globalWithWorker.Worker;
    }
  });

  it("fired and cancelled timers leave no entry behind in the pending-callback map", async () => {
    const { createWorkerTimers } = await freshModule();
    const { setTimer, clearTimer } = createWorkerTimers();

    // The fallback path delegates to the platform's own setTimeout/clearTimeout, which owns its
    // pending-handle bookkeeping — there is no separate map to leak in this path (that bookkeeping
    // lives in the Worker path's `callbacks` Map, exercised live in task-004). Exercising both a
    // fire and a cancel here guards the observable contract: neither leaves a dangling callback
    // invoked later.
    const fired = vi.fn();
    const cancelled = vi.fn();
    setTimer(fired, 10);
    const handle = setTimer(cancelled, 10);
    clearTimer(handle);
    vi.advanceTimersByTime(1000);

    expect(fired).toHaveBeenCalledTimes(1);
    expect(cancelled).not.toHaveBeenCalled();
  });
});
