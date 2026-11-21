// Run with `node --test 'apps/ipc-bench/page/*.test.mjs'` from `desktop/`. The stall watchdog of a workload run,
// on mocked timers and a mocked clock.
import assert from "node:assert/strict";
import test from "node:test";
import { newRun, watchFrames } from "./run.js";

/**
 * Mocked timers and clock. `tick` is made to advance one second at a time: the mocked `Date` only moves to
 * the end of a tick, so the watchdog (which polls every second) would otherwise see the time jump.
 */
const enable = (t) => {
  const timers = t.mock.timers;
  timers.enable({ apis: ["setTimeout", "setInterval", "Date"] });
  const tick = timers.tick.bind(timers);
  timers.tick = (ms) => {
    for (let left = ms; left > 0; left -= 1000) tick(Math.min(1000, left));
  };
};
/** Lets every pending promise callback run (setImmediate is not mocked). */
const flush = () => new Promise((resolve) => setImmediate(resolve));

/** What `run.wait(never)` has done so far: nothing, or rejected with a message. */
function watch(run) {
  const state = { error: null };
  run.wait(new Promise(() => {})).catch((error) => {
    state.error = error.message;
  });
  return state;
}

test("a run that sees nothing for 30 s fails at once, with what the transport says of itself", async (t) => {
  enable(t);
  const run = newRun(600_000, { explain: async () => "Rust sent 12130 frames; the connection ended by itself" });
  const state = watch(run);
  t.mock.timers.tick(29_000);
  await flush();
  assert.equal(state.error, null, "29 s of quiet is not a stall");
  t.mock.timers.tick(2000);
  await flush();
  assert.match(state.error, /^stalled: no frame and no end for 3\d s; Rust sent 12130 frames; the connection ended by itself$/);
  run.end();
});

test("a frame, a changed fingerprint or a running harness command is progress; quiet after it counts from there", async (t) => {
  enable(t);
  let buffered = 0;
  let commands = 0;
  const run = newRun(600_000, { fingerprint: () => buffered, busy: () => commands > 0 });
  const state = watch(run);
  for (let i = 0; i < 6; i++) {
    t.mock.timers.tick(10_000);
    run.touch();
  }
  for (let i = 0; i < 6; i++) {
    t.mock.timers.tick(10_000);
    buffered += 1024;
  }
  commands = 1;
  t.mock.timers.tick(120_000);
  commands = 0;
  await flush();
  assert.equal(state.error, null, "three minutes with signs of life");
  t.mock.timers.tick(31_000);
  await flush();
  assert.match(state.error, /^stalled: /);
  run.end();
});

test("a transport that cannot say what it counts still fails the run, and says so after 2 s", async (t) => {
  enable(t);
  const run = newRun(600_000, { explain: () => new Promise(() => {}) });
  const state = watch(run);
  t.mock.timers.tick(31_000);
  await flush();
  assert.equal(state.error, null, "waiting for the counters");
  t.mock.timers.tick(2000);
  await flush();
  assert.match(state.error, /^stalled: .*\(the counters did not answer in 2 s\)$/);
  run.end();
});

test("an explain that throws is reported, not lost", async (t) => {
  enable(t);
  const run = newRun(600_000, {
    explain: () => {
      throw new Error("no such connection");
    },
  });
  const state = watch(run);
  t.mock.timers.tick(31_000);
  await flush();
  assert.match(state.error, /^stalled: .*\(the counters are not available: no such connection\)$/);
  run.end();
});

test("end() stops the watchdog and the deadline; the first failure wins", async (t) => {
  enable(t);
  let explained = 0;
  const run = newRun(600_000, { explain: () => ++explained && "x" });
  const state = watch(run);
  run.end();
  assert.equal(run.over, true);
  t.mock.timers.tick(1_000_000);
  await flush();
  assert.equal(state.error, null);
  assert.equal(explained, 0);

  const second = newRun(600_000);
  const failed = watch(second);
  second.fail(new Error("the socket closed before the end (code 1006)"));
  t.mock.timers.tick(100_000);
  await flush();
  assert.equal(failed.error, "the socket closed before the end (code 1006)");
  second.end();
});

test("stallMs 0 turns the watchdog off; the deadline still fires", async (t) => {
  enable(t);
  const run = newRun(120_000, { stallMs: 0 });
  const state = watch(run);
  t.mock.timers.tick(119_000);
  await flush();
  assert.equal(state.error, null);
  t.mock.timers.tick(2000);
  await flush();
  assert.equal(state.error, "no end after 120 s");
  run.end();
});

test("watchFrames counts every frame handed to onMessage and calls the handler as before", async (t) => {
  enable(t);
  const run = newRun(600_000);
  const transport = { onMessage: null };
  watchFrames(transport, run);
  assert.equal(transport.onMessage, null);
  const got = [];
  transport.onMessage = (data) => got.push(data);
  // One frame every 20 s for 5 minutes: the run is alive, the deadline is far.
  const state = watch(run);
  for (let i = 0; i < 15; i++) {
    t.mock.timers.tick(20_000);
    assert.equal(transport.onMessage(`frame ${i}`), i + 1);
  }
  await flush();
  assert.equal(got.length, 15);
  assert.equal(state.error, null);
  transport.onMessage = null;
  assert.equal(transport.onMessage, null);
  run.end();
});
