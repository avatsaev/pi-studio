// Run with `node --test 'apps/ipc-bench/page/*.test.mjs'` from `desktop/`.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { CAUGHT_UP_LAG_FRAMES, StreamClock, TimerChain, catchUpMs, deliveredAt, summarizeTimers } from "./hidden.js";
import { WORKER_SOURCE } from "./worker-timers.js";

/** A clock and timers the test drives: `advance(ms)` runs the timers that fall due, in order, as far as `ms` later. */
function fakeTimers() {
  let now = 0;
  let nextHandle = 1;
  const armed = new Map();
  return {
    now: () => now,
    setTimer(cb, ms) {
      const handle = nextHandle++;
      armed.set(handle, { cb, at: now + ms });
      return handle;
    },
    clearTimer: (handle) => armed.delete(handle),
    /** Runs what is due by `to`; a timer fires at its own time unless `lateBy` holds it back. */
    advance(to, lateBy = 0) {
      for (;;) {
        const next = [...armed.entries()].sort((a, b) => a[1].at - b[1].at)[0];
        if (!next || next[1].at > to) break;
        armed.delete(next[0]);
        now = next[1].at + lateBy;
        next[1].cb();
        lateBy = 0;
      }
      now = Math.max(now, to);
    },
  };
}

test("a chain re-arms after each fire and records how late each one was", () => {
  const t = fakeTimers();
  const chain = new TimerChain({ intervalMs: 500, now: t.now, setTimer: t.setTimer, clearTimer: t.clearTimer });
  chain.start();
  t.advance(500); // on time: due 500
  t.advance(1000, 40); // due 1000, fires at 1040 (and the next is due at 1540)
  t.advance(1600); // due 1540, on time at 1540
  assert.deepEqual(
    chain.samples.map((s) => [s.dueMs, s.atMs, s.delayMs]),
    [
      [500, 500, 0],
      [1000, 1040, 40],
      [1540, 1540, 0],
    ],
  );
  chain.stop();
  t.advance(5000);
  assert.equal(chain.samples.length, 3, "a stopped chain does not fire");
});

test("the summary reads the fires due while the window was away, however late they fired", () => {
  const t = fakeTimers();
  const chain = new TimerChain({ intervalMs: 500, now: t.now, setTimer: t.setTimer, clearTimer: t.clearTimer });
  chain.start();
  t.advance(1000); // fires at 500 and 1000
  // The window goes away at 1100; the timer due at 1500 fires at 9000 (the page was held), then it runs again.
  t.advance(1500, 7500);
  t.advance(10000);
  const summary = summarizeTimers(chain, 1100, 8000);
  assert.equal(summary.expectedFires, 13);
  assert.equal(summary.firedWhileHidden, 0, "nothing fired between 1100 and 8000");
  assert.equal(summary.dueWhileHidden, 1);
  assert.equal(summary.maxDelayMs, 7500);
  chain.stop();
});

test("a timer that never fired is counted by how late it is when the chain stops", () => {
  // A timer armed at 0 for 500 ms that a held-back page never fires: the clock reaches 4000.
  const t = fakeTimers();
  const stuck = new TimerChain({ intervalMs: 500, now: t.now, setTimer: () => 1, clearTimer: () => {} });
  stuck.start();
  t.advance(4000);
  stuck.stop();
  stuck.stop();
  assert.deepEqual(stuck.pending(), { dueMs: 500, lateMs: 3500 });
  const summary = summarizeTimers(stuck, 100, 3000);
  assert.equal(summary.maxDelayMs, 3500);
  assert.equal(summary.firedWhileHidden, 0);
});

test("a window that was not hidden shows timers on time", () => {
  const t = fakeTimers();
  const chain = new TimerChain({ intervalMs: 500, now: t.now, setTimer: t.setTimer, clearTimer: t.clearTimer });
  chain.start();
  t.advance(10000);
  const summary = summarizeTimers(chain, 2250, 8250);
  assert.equal(summary.expectedFires, 12);
  assert.equal(summary.firedWhileHidden, 12);
  assert.equal(summary.maxDelayMs, 0);
  assert.equal(summary.meanDelayMs, 0);
  chain.stop();
});

test("the stream clock says how many frames exist by a time and how far behind a page is", () => {
  const clock = new StreamClock({ rate: 1000, total: 5000, t0: 100 });
  assert.equal(clock.expected(50), 0);
  assert.equal(clock.expected(1100), 1000);
  assert.equal(clock.expected(99999), 5000, "never more than the stream has");
  assert.equal(clock.lag(900, 1100), 100);
  assert.equal(clock.lag(1200, 1100), 0);
});

test("delivered frames are read from the trace at a time, and the catch-up is the first sample close enough after the show", () => {
  const clock = new StreamClock({ rate: 1000, total: 10000, t0: 0 });
  const trace = [
    { atMs: 100, delivered: 100 },
    { atMs: 1000, delivered: 1000 },
    // The window is away from 1100 to 5100: nothing is delivered, the stream goes on.
    { atMs: 5300, delivered: 1500 }, // 3800 behind
    { atMs: 5400, delivered: 4000 }, // 1400 behind
    { atMs: 5500, delivered: 5300 }, // 200 behind
    { atMs: 5600, delivered: 5550 }, // 50 behind: caught up
  ];
  assert.equal(deliveredAt(trace, 50), 0);
  assert.equal(deliveredAt(trace, 1100), 1000);
  assert.equal(deliveredAt(trace, 5100) - deliveredAt(trace, 1100), 0, "no frame delivered while hidden");
  assert.equal(catchUpMs(trace, clock, 5100), 500);
  // A page that never fell behind needs no time.
  const live = [
    { atMs: 1000, delivered: 1000 },
    { atMs: 5000, delivered: 5000 },
    { atMs: 5200, delivered: 5200 },
  ];
  assert.equal(catchUpMs(live, clock, 5100), 0);
  // A trace that never gets close: the caller decides.
  assert.equal(catchUpMs(trace.slice(0, 3), clock, 5100), null);
  assert.equal(CAUGHT_UP_LAG_FRAMES, 100);
});

test("the worker's source is the one of the app's worker timers", () => {
  const app = readFileSync(new URL("../../../../packages/workbench/src/host/browser-worker-timers.ts", import.meta.url), "utf8");
  const quoted = /const WORKER_SOURCE = `([\s\S]*?)`;/.exec(app);
  assert.ok(quoted, "browser-worker-timers.ts no longer has a WORKER_SOURCE template: update page/worker-timers.js");
  assert.equal(WORKER_SOURCE, quoted[1], "the worker source of page/worker-timers.js differs from browser-worker-timers.ts: copy it again");
});
