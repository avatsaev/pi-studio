// Rows B7 and B8 of `swe/features/desktop-transport-bridge.md` § 1, on the helpers of `workloads.js`.
//
//   B7  echo under load: row B1's echo (32-byte frames, one at a time) on the same connection while
//       row B4's download (1 GiB as 32 KiB frames) runs; the round trips, the 99th percentile first
//   B8  a hidden window: 1,000 inbound frames a second for 30 s while Rust hides (or minimises) the
//       window and brings it back; frames lost, bytes Rust held, how long the page took to catch up,
//       how late a 500 ms timer in a worker and one on the page fired, and the largest gap of a
//       2-second tick on the Rust side

import { BASIS, StreamCheck, binaryFrame, binaryTemplate, hex, mix } from "./frame.js";
import { CAUGHT_UP_LAG_FRAMES, StreamClock, TIMER_MS, TimerChain, catchUpMs, deliveredAt, summarizeTimers } from "./hidden.js";
import { round, summarize } from "./stats.js";
import { GIB, MIB, addProblem, integrity, mibPerS, sleep, withTransport } from "./workloads.js";
import { createWorkerTimers } from "./worker-timers.js";

// ---------------------------------------------------------------------------------------- B7

const ECHO_BYTES = 32;
const ECHO_WARMUP = 5;
const DOWNLOAD_FRAME = 32 * 1024;
/** How many of the slowest round trips the record keeps. */
const SLOWEST_KEPT = 20;

/** Two integrity verdicts as one, each problem saying which stream it is about. */
function mergeVerdicts(named) {
  const errors = [];
  let errorCount = 0;
  for (const [name, verdict] of named) {
    errorCount += verdict.errorCount;
    for (const e of verdict.errors) errors.push({ frame: e.frame, problem: `${name}: ${e.problem}` });
  }
  return { ok: named.every(([, v]) => v.ok), frames: named.reduce((n, [, v]) => n + v.frames, 0), errorCount, errors };
}

async function echoUnderLoad(ctx) {
  const frames = Math.max(1, Math.round((GIB * ctx.scale) / DOWNLOAD_FRAME));
  return withTransport(ctx, `/mixed?frames=${frames}&size=${DOWNLOAD_FRAME}`, async (transport, run) => {
    const download = new StreamCheck();
    const echoed = new StreamCheck();
    const template = binaryTemplate(ECHO_BYTES);
    let chain = BASIS;
    let waiting = null;
    let finished = false;
    let finishedAt = 0;
    let finish;
    const done = new Promise((resolve) => {
      finish = resolve;
    });
    transport.onMessage = (data) => {
      if (typeof data === "string") {
        finished = true;
        finishedAt = performance.now();
        finish(JSON.parse(data));
      } else if (data.byteLength === ECHO_BYTES) {
        echoed.accept(data);
        const resolve = waiting;
        waiting = null;
        if (resolve) resolve();
      } else download.accept(data);
    };
    const samples = [];
    let sent = 0;
    const start = performance.now();
    transport.sendText("go");
    while (!finished) {
      const { frame, sum } = binaryFrame(template, sent);
      chain = mix(chain, sum);
      const reply = new Promise((resolve) => {
        waiting = resolve;
      });
      const sentAt = performance.now();
      transport.sendBinary(frame);
      sent++;
      await run.wait(reply);
      if (sent > ECHO_WARMUP) samples.push(performance.now() - sentAt);
    }
    const closing = await run.wait(done);
    const downloaded = download.report();
    const downloadMs = finishedAt - start;
    const stats = summarize(samples);
    const total = samples.reduce((a, b) => a + b, 0);
    return {
      trips: samples.length,
      warmup: ECHO_WARMUP,
      frameBytes: ECHO_BYTES,
      downloadFrameBytes: DOWNLOAD_FRAME,
      downloadBytes: downloaded.bytes,
      downloadMs: round(downloadMs),
      downloadMibPerS: round(mibPerS(downloaded.bytes, downloadMs)),
      meanMs: round(samples.length ? total / samples.length : null, 4),
      medianMs: round(stats.median),
      p90Ms: round(stats.p90),
      p99Ms: round(stats.p99),
      minMs: round(stats.min),
      maxMs: round(stats.max),
      slowestMs: samples
        .slice()
        .sort((a, b) => b - a)
        .slice(0, SLOWEST_KEPT)
        .map((s) => round(s)),
      integrity: mergeVerdicts([
        ["download", integrity(downloaded, { frames: closing.frames, bytes: closing.bytes, hash: closing.hash })],
        ["echo", integrity(echoed.report(), { frames: sent, bytes: sent * ECHO_BYTES, hash: hex(chain) })],
      ]),
    };
  });
}

// ---------------------------------------------------------------------------------------- B8

const PACED_RATE = 1000;
const PACED_FRAME = 4096;
const HIDDEN_SECONDS = 30;
/** The window is visible this long before it goes, so that the stream is flowing and the timers are running. */
const LEAD_MS = 1000;
/** The stream runs this long after the window is back (the hold's own settling takes some of it). */
const TAIL_SECONDS = 1;
/** The spec's high mark (§ 3). Rust stops reading once more than this is unacknowledged and reads at most one frame more. */
const WINDOW_HIGH = 8 * MIB;
/** A sample of how many frames the page has delivered is taken at most this often. */
const TRACE_EVERY_MS = 10;

/** The window's states as the page and the system saw them around one hold. */
function windowRecord(hold, events, hideAt, showAt) {
  const sawHidden = events.some((e) => e.state === "hidden" && e.atMs >= hideAt - 50 && e.atMs <= showAt + 50);
  return {
    mode: hold.mode,
    afterHide: hold.afterHide,
    afterShow: hold.afterShow,
    systemHidIt: !hold.afterHide.visible || hold.afterHide.minimized,
    pageSawHidden: sawHidden,
    pageVisibilityEvents: events.map((e) => ({ atMs: round(e.atMs - hideAt, 0), state: e.state })),
  };
}

async function hiddenWindow(ctx, mode) {
  const hiddenSeconds = Math.max(2, Math.round(HIDDEN_SECONDS * ctx.scale));
  const seconds = hiddenSeconds + LEAD_MS / 1000 + TAIL_SECONDS;
  const total = PACED_RATE * seconds;
  const path = `/paced?rate=${PACED_RATE}&seconds=${seconds}&size=${PACED_FRAME}`;
  return withTransport(ctx, path, async (transport, run) => {
    const check = new StreamCheck();
    let delivered = 0;
    let lastTraced = -Infinity;
    const trace = [];
    let finish;
    const done = new Promise((resolve) => {
      finish = resolve;
    });
    let doneAt = 0;
    transport.onMessage = (data) => {
      const now = performance.now();
      if (typeof data === "string") {
        doneAt = now;
        finish(JSON.parse(data));
        return;
      }
      check.accept(data);
      delivered++;
      if (now - lastTraced >= TRACE_EVERY_MS) {
        trace.push({ atMs: now, delivered });
        lastTraced = now;
      }
    };
    const events = [];
    const onVisibility = () => events.push({ atMs: performance.now(), state: document.visibilityState });
    document.addEventListener("visibilitychange", onVisibility);
    const workerTimers = createWorkerTimers();
    const clock = () => performance.now();
    const pageChain = new TimerChain({ intervalMs: TIMER_MS, now: clock, setTimer: (cb, ms) => setTimeout(cb, ms), clearTimer: (h) => clearTimeout(h) });
    const workerChain = new TimerChain({ intervalMs: TIMER_MS, now: clock, setTimer: workerTimers.setTimer, clearTimer: workerTimers.clearTimer });
    let ticking = false;
    try {
      await run.wait(ctx.invoke("bench_tick_start"));
      ticking = true;
      pageChain.start();
      workerChain.start();
      const t0 = performance.now();
      transport.sendText("go");
      await run.wait(sleep(LEAD_MS));
      const holdStart = performance.now();
      // Rust hides the window, waits, and shows it again: a hidden page may not be able to do it.
      const hold = await run.wait(ctx.invoke("bench_window_hold", { mode, holdMs: hiddenSeconds * 1000 }));
      const hideAt = holdStart + hold.hiddenFromMs;
      const showAt = holdStart + hold.shownAtMs;
      const closing = await run.wait(done);
      pageChain.stop();
      workerChain.stop();
      const rustTick = await run.wait(ctx.invoke("bench_tick_stop"));
      ticking = false;
      const streamClock = new StreamClock({ rate: PACED_RATE, total, t0 });
      const report = check.report();
      const lost = Math.max(0, closing.frames - report.frames);
      const caughtUp = catchUpMs(trace, streamClock, showAt);
      const held = typeof transport.stats === "function" ? await run.wait(transport.stats()) : null;
      const heldBytes = held ? held.maxOutstanding : null;
      const verdict = integrity(report, { frames: closing.frames, bytes: closing.bytes, hash: closing.hash });
      if (lost > 0) addProblem(verdict, `${lost} of ${closing.frames} frames were lost while the window was ${mode === "hide" ? "hidden" : "minimised"}`);
      if (heldBytes !== null && heldBytes > WINDOW_HIGH + 2 * PACED_FRAME) {
        addProblem(verdict, `Rust held ${heldBytes} bytes: more than the ${WINDOW_HIGH}-byte window and a frame`);
      }
      const win = windowRecord(hold, events, hideAt, showAt);
      return {
        mode,
        rate: PACED_RATE,
        frameBytes: PACED_FRAME,
        hiddenMs: round(showAt - hideAt, 0),
        frames: report.frames,
        framesSent: closing.frames,
        lostFrames: lost,
        heldBytes,
        windowHighBytes: held ? WINDOW_HIGH : null,
        pausesOfReading: held ? held.pauses : null,
        framesDeliveredWhileHidden: deliveredAt(trace, showAt) - deliveredAt(trace, hideAt),
        framesBehindAtShow: streamClock.lag(deliveredAt(trace, showAt), showAt),
        catchUpMs: round(caughtUp === null ? Math.max(0, doneAt - showAt) : caughtUp, 0),
        caughtUpSlackFrames: CAUGHT_UP_LAG_FRAMES,
        window: win,
        workerTimer: { backend: workerTimers.backend, ...summarizeTimers(workerChain, hideAt, showAt) },
        pageTimer: summarizeTimers(pageChain, hideAt, showAt),
        rustTick: rustTick,
        integrity: verdict,
      };
    } finally {
      document.removeEventListener("visibilitychange", onVisibility);
      pageChain.stop();
      workerChain.stop();
      workerTimers.dispose();
      if (ticking) await ctx.invoke("bench_tick_stop").catch(() => {});
    }
  });
}

/** The workloads of this file, in `WORKLOADS`' shape. */
export const LOAD_WORKLOADS = [
  {
    row: "b7",
    id: "B7",
    variant: "",
    title: "echo while a download runs",
    metrics: [["p99Ms", "max"], ["meanMs", "max"], ["medianMs", "max"], ["downloadMibPerS", "min"]],
    run: echoUnderLoad,
  },
  {
    row: "b8",
    id: "B8",
    variant: "hide",
    title: "1,000 frames/s for 30 s with the window hidden",
    metrics: [["lostFrames", "max"], ["heldBytes", "max"], ["catchUpMs", "max"], ["workerTimer.maxDelayMs", "max"], ["pageTimer.maxDelayMs", "max"], ["rustTick.maxDelayMs", "max"]],
    run: (ctx) => hiddenWindow(ctx, "hide"),
  },
  {
    row: "b8",
    id: "B8",
    variant: "minimise",
    title: "1,000 frames/s for 30 s with the window minimised",
    metrics: [["lostFrames", "max"], ["heldBytes", "max"], ["catchUpMs", "max"], ["workerTimer.maxDelayMs", "max"], ["pageTimer.maxDelayMs", "max"], ["rustTick.maxDelayMs", "max"]],
    run: (ctx) => hiddenWindow(ctx, "minimize"),
  },
];
