// The workloads of `swe/features/desktop-transport-bridge.md` § 1, rows B1 to B5. Each runs against
// one transport (see `transport.js`) and a server path, and returns its raw measurements plus the
// result of row B6 (counter, checksum and running hash of every stream) in `integrity`.
//
//   B1  keystroke echo: round trips of a 32-byte binary frame, one at a time
//   B2  terminal flood: 256 MiB inbound as 4 KiB, 64 KiB and 256 KiB binary frames
//   B3  many small frames: 200,000 inbound text frames of 200 bytes
//   B4  download: 1 GiB inbound as 32 KiB binary frames, with the memory of the app's processes
//   B5  upload: 256 MiB outbound as 32 KiB binary frames, paced on bufferedAmount at 1 MiB
//   W1  (candidates only) the page never acknowledges: Rust must stop reading at the window
//
// Rows B7 and B8 are in `load.js`, written on the helpers exported here.

import { BASIS, StreamCheck, binaryFrame, binaryTemplate, hex, mix } from "./frame.js";
import { round, summarize } from "./stats.js";

export const MIB = 1024 * 1024;
export const GIB = 1024 * MIB;
/** The pacing the SDK's upload uses (`UPLOAD_POLL_MS` in file-transfer-client.ts), and the spec's 1 MiB. */
const UPLOAD_HIGH_WATER = 1 * MIB;
const UPLOAD_POLL_MS = 10;
/** How long the answers of the last sends may take after the sink's report, before `bufferedAmount` must be 0. */
const UPLOAD_SETTLE_MS = 2000;
const MEMORY_SAMPLE_MS = 250;

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
export const scaled = (count, scale) => Math.max(1, Math.round(count * scale));

/**
 * A run's deadline and failure channel. `await run.wait(promise)` settles with the promise, or
 * rejects when the run times out or the socket closes before the run is over.
 */
function newRun(timeoutMs) {
  let fail;
  const failed = new Promise((_, reject) => {
    fail = reject;
  });
  failed.catch(() => {});
  const timer = setTimeout(() => fail(new Error(`no end after ${timeoutMs / 1000} s`)), timeoutMs);
  let over = false;
  return {
    fail,
    wait: (promise) => Promise.race([promise, failed]),
    get over() {
      return over;
    },
    end() {
      over = true;
      clearTimeout(timer);
    },
  };
}

/** A transport, connected to `path`, closed again at the end; a close before the end fails the run. */
export async function withTransport(ctx, path, body, options = {}) {
  const run = newRun(ctx.runTimeoutMs);
  const transport = ctx.transport.create(options);
  transport.onClose = (code, reason) => {
    if (!run.over) run.fail(new Error(`the socket closed before the end (code ${code}${reason ? `, ${reason}` : ""})`));
  };
  transport.onError = (error) => {
    if (!run.over) run.fail(new Error(`socket error: ${error && error.message ? error.message : String(error)}`));
  };
  try {
    await run.wait(transport.connect(ctx.url(path)));
    const result = await body(transport, run);
    // The candidates' record of the run: the IPC path, the out-of-order count, the window's numbers.
    if (transport.report) result.ipc = await run.wait(transport.report());
    return result;
  } finally {
    run.end();
    transport.close(1000, "done");
  }
}

/**
 * Row B6 for one run. `counted` is what a checker saw (`StreamCheck.report()`); `sent` is what the
 * other end says it made: its frames, bytes and running hash. Anything that differs is an error,
 * and so is every error the checker found (each names its frame).
 */
export function integrity(counted, sent) {
  const problems = counted.errors.map((e) => ({ frame: e.frame, problem: e.problem }));
  const note = (problem) => problems.push({ frame: null, problem });
  if (counted.frames !== sent.frames) note(`${sent.frames} frames were sent and ${counted.frames} were counted`);
  if (counted.bytes !== sent.bytes) note(`${sent.bytes} bytes were sent and ${counted.bytes} were counted`);
  if (counted.hash !== sent.hash) note(`the running hash is ${counted.hash} where the frames were counted and ${sent.hash} where they were made`);
  return {
    ok: problems.length === 0 && counted.errorCount === 0,
    frames: counted.frames,
    errorCount: counted.errorCount + (problems.length - counted.errors.length),
    errors: problems,
    countedHash: counted.hash,
    sentHash: sent.hash,
  };
}

export const mibPerS = (bytes, ms) => bytes / MIB / (ms / 1000);

// ---------------------------------------------------------------------------------------- B1

async function echo(ctx) {
  const trips = scaled(2000, ctx.scale);
  const warmup = Math.max(5, scaled(100, ctx.scale));
  const size = 32;
  return withTransport(ctx, "/echo", async (transport, run) => {
    const template = binaryTemplate(size);
    const check = new StreamCheck();
    let chain = BASIS;
    let waiting = null;
    transport.onMessage = (data) => {
      const resolve = waiting;
      waiting = null;
      if (resolve) resolve(data);
    };
    const samples = [];
    for (let i = 0; i < trips + warmup; i++) {
      const { frame, sum } = binaryFrame(template, i);
      chain = mix(chain, sum);
      const reply = new Promise((resolve) => {
        waiting = resolve;
      });
      const start = performance.now();
      transport.sendBinary(frame);
      const data = await run.wait(reply);
      const elapsed = performance.now() - start;
      check.accept(data);
      if (i >= warmup) samples.push(elapsed);
    }
    const stats = summarize(samples);
    const totalMs = samples.reduce((a, b) => a + b, 0);
    return {
      trips,
      warmup,
      frameBytes: size,
      totalMs: round(totalMs),
      meanMs: round(totalMs / trips, 4),
      medianMs: round(stats.median),
      p90Ms: round(stats.p90),
      p99Ms: round(stats.p99),
      minMs: round(stats.min),
      maxMs: round(stats.max),
      samplesMs: samples.map((s) => round(s)),
      integrity: integrity(check.report(), { frames: trips + warmup, bytes: (trips + warmup) * size, hash: hex(chain) }),
    };
  });
}

// ------------------------------------------------------------------------------- B2, B3, B4

async function flood(ctx, { kind, size, frames, memory }) {
  const path = `/flood?frames=${frames}&size=${size}&kind=${kind}`;
  return withTransport(ctx, path, async (transport, run) => {
    const check = new StreamCheck();
    let finish;
    const done = new Promise((resolve) => {
      finish = resolve;
    });
    transport.onMessage = (data) => {
      // A text flood's frames start with a digit; the server's closing message is JSON.
      if (typeof data === "string" && data.charCodeAt(0) === 123) finish(JSON.parse(data));
      else check.accept(data);
    };
    const sampler = memory ? await startMemorySampler(ctx) : null;
    let timing;
    let sampled = null;
    try {
      const start = performance.now();
      transport.sendText("go");
      const closing = await run.wait(done);
      timing = { closing, durationMs: performance.now() - start };
    } finally {
      if (sampler) sampled = await sampler.stop();
    }
    const report = check.report();
    const result = {
      kind,
      frameBytes: size,
      frames: report.frames,
      bytes: report.bytes,
      durationMs: round(timing.durationMs),
      mibPerS: round(mibPerS(report.bytes, timing.durationMs)),
      framesPerS: round(report.frames / (timing.durationMs / 1000), 1),
      serverFrames: timing.closing.frames,
      serverBytes: timing.closing.bytes,
      integrity: integrity(report, { frames: timing.closing.frames, bytes: timing.closing.bytes, hash: timing.closing.hash }),
    };
    if (sampled) result.memory = sampled;
    return result;
  });
}

/**
 * Samples the resident memory of the app's processes (Rust: `bench_rss`) before, every
 * `MEMORY_SAMPLE_MS` during and after a run. Growth is the peak minus the start.
 */
export async function startMemorySampler(ctx) {
  const first = await ctx.rss();
  const samples = [{ atMs: 0, totalKiB: first.totalKib, processes: first.processes.length }];
  const t0 = performance.now();
  let stopped = false;
  const loop = (async () => {
    while (!stopped) {
      await sleep(MEMORY_SAMPLE_MS);
      if (stopped) break;
      const now = await ctx.rss();
      samples.push({ atMs: round(performance.now() - t0, 0), totalKiB: now.totalKib, processes: now.processes.length });
    }
  })();
  return {
    async stop() {
      stopped = true;
      await loop;
      const last = await ctx.rss();
      samples.push({ atMs: round(performance.now() - t0, 0), totalKiB: last.totalKib, processes: last.processes.length });
      const peak = Math.max(...samples.map((s) => s.totalKiB));
      return {
        startKiB: first.totalKib,
        peakKiB: peak,
        endKiB: last.totalKib,
        growthKiB: peak - first.totalKib,
        processesAtStart: first.processes,
        processesAtEnd: last.processes,
        samples,
      };
    },
  };
}

// ---------------------------------------------------------------------------------------- B5

async function upload(ctx) {
  const size = 32 * 1024;
  const frames = Math.max(1, Math.round((256 * MIB * ctx.scale) / size));
  return withTransport(ctx, "/sink", async (transport, run) => {
    let finish;
    const answer = new Promise((resolve) => {
      finish = resolve;
    });
    transport.onMessage = (data) => {
      if (typeof data === "string") finish(JSON.parse(data));
    };
    const template = binaryTemplate(size);
    let chain = BASIS;
    let maxBuffered = 0;
    let polls = 0;
    const start = performance.now();
    for (let i = 0; i < frames; i++) {
      // Paced as the SDK's upload is: wait while more than 1 MiB is queued.
      while (transport.bufferedAmount > UPLOAD_HIGH_WATER) {
        maxBuffered = Math.max(maxBuffered, transport.bufferedAmount);
        polls++;
        await run.wait(sleep(UPLOAD_POLL_MS));
      }
      const { frame, sum } = binaryFrame(template, i);
      chain = mix(chain, sum);
      transport.sendBinary(frame);
    }
    transport.sendText("end");
    const reply = await run.wait(answer);
    const durationMs = performance.now() - start;
    // The report can overtake the answers of the last sends (it travels another way in a bridge): give
    // the answers a moment, and record both numbers. `bufferedAmountEnd` is the one that must be 0.
    const bufferedAmountAtReport = transport.bufferedAmount;
    const settleStart = performance.now();
    while (transport.bufferedAmount > 0 && performance.now() - settleStart < UPLOAD_SETTLE_MS) await run.wait(sleep(5));
    const settleMs = performance.now() - settleStart;
    const bufferedAmountEnd = transport.bufferedAmount;
    if (reply.type !== "report") throw new Error(`the sink answered ${JSON.stringify(reply).slice(0, 200)}`);
    const bytes = frames * size;
    const verdict = integrity(reply.report, { frames, bytes, hash: hex(chain) });
    return {
      frameBytes: size,
      frames,
      bytes,
      durationMs: round(durationMs),
      mibPerS: round(mibPerS(bytes, durationMs)),
      framesPerS: round(frames / (durationMs / 1000), 1),
      bufferedAmountAtReport,
      bufferedAmountEnd,
      settleMs: round(settleMs),
      maxBufferedAmountSeen: maxBuffered,
      pacingWaits: polls,
      integrity: verdict,
    };
  });
}

// -------------------------------------------------------------------------- window test

const WINDOW_FRAME = 64 * 1024;
/** More than the window and every buffer between Rust and the server can hold, whatever the scale. */
const WINDOW_FLOOD_BYTES = 128 * MIB;
/** The spec's high mark (§ 3): Rust stops reading once more than this is unacknowledged. */
const WINDOW_HIGH = 8 * MIB;
const STALL_SAMPLE_MS = 250;
const STALL_STABLE_SAMPLES = 6;
const STALL_GIVE_UP_MS = 60 * 1000;

/** Samples Rust's counters until the bytes it sent and the bytes the server handed on stop changing. */
async function waitForStall(transport, run) {
  const trace = [];
  const started = performance.now();
  let key = null;
  let stable = 0;
  let stats;
  while (stable < STALL_STABLE_SAMPLES) {
    await run.wait(sleep(STALL_SAMPLE_MS));
    stats = await run.wait(transport.stats());
    const now = `${stats.bytesIn}/${stats.serverFedBytes}`;
    stable = now === key ? stable + 1 : 0;
    key = now;
    trace.push({ atMs: round(performance.now() - started, 0), bytesIn: stats.bytesIn, outstanding: stats.outstanding, serverFedBytes: stats.serverFedBytes });
    if (performance.now() - started > STALL_GIVE_UP_MS) throw new Error(`the flood neither finished nor stopped in ${STALL_GIVE_UP_MS / 1000} s`);
  }
  return { stats, trace, stalledAfterMs: trace[Math.max(0, trace.length - STALL_STABLE_SAMPLES - 1)].atMs };
}

/** An integrity verdict plus a problem of the window test. */
export function addProblem(verdict, problem) {
  verdict.ok = false;
  verdict.errorCount++;
  verdict.errors.push({ frame: null, problem });
}

/**
 * The page never acknowledges. Rust must stop reading just past the window (8 MiB), so that the
 * server's sends stall; then the page acknowledges, the flood resumes and arrives whole.
 */
async function noAck(ctx) {
  const frames = WINDOW_FLOOD_BYTES / WINDOW_FRAME;
  return withTransport(
    ctx,
    `/flood?frames=${frames}&size=${WINDOW_FRAME}&kind=binary`,
    async (transport, run) => {
      const check = new StreamCheck();
      let finished = false;
      let finish;
      const done = new Promise((resolve) => {
        finish = resolve;
      });
      transport.onMessage = (data) => {
        if (typeof data === "string" && data.charCodeAt(0) === 123) {
          finished = true;
          finish(JSON.parse(data));
        } else check.accept(data);
      };
      const before = await run.wait(transport.stats());
      transport.sendText("go");
      const stall = await waitForStall(transport, run);
      const held = stall.stats;
      const problems = [];
      if (finished) problems.push("the flood finished although the page never acknowledged");
      if (held.outstanding <= WINDOW_HIGH) problems.push(`Rust holds ${held.outstanding} bytes: it stopped below the ${WINDOW_HIGH}-byte window`);
      if (held.outstanding > WINDOW_HIGH + 2 * WINDOW_FRAME + 5) problems.push(`Rust holds ${held.outstanding} bytes: it read on past the ${WINDOW_HIGH}-byte window`);
      if (held.mayRead) problems.push("the window still lets Rust read");
      const fed = held.serverFedBytes - before.serverFedBytes;
      if (fed >= WINDOW_FLOOD_BYTES) problems.push("the server sent the whole flood: its sends did not stall");
      // The window opens: from here the page acknowledges, as in a normal run.
      await run.wait(transport.enableAck());
      const closing = await run.wait(done);
      const report = check.report();
      const verdict = integrity(report, { frames: closing.frames, bytes: closing.bytes, hash: closing.hash });
      for (const problem of problems) addProblem(verdict, problem);
      return {
        frameBytes: WINDOW_FRAME,
        frames: report.frames,
        bytes: report.bytes,
        heldBytes: held.outstanding,
        windowHighBytes: WINDOW_HIGH,
        readingStopped: !held.mayRead,
        pauses: held.pauses,
        serverFedBytes: fed,
        serverFedMiB: round(fed / MIB, 2),
        serverFloodBytes: WINDOW_FLOOD_BYTES,
        stalledAfterMs: stall.stalledAfterMs,
        trace: stall.trace,
        integrity: verdict,
      };
    },
    { ack: false },
  );
}

/**
 * The workloads, in the order they run. `row` is what `--only` names; `metrics` are the numbers the
 * summary reports, with the direction in which a run is worse.
 */
export const WORKLOADS = [
  { row: "b1", id: "B1", variant: "", title: "keystroke echo", metrics: [["medianMs", "max"], ["p99Ms", "max"], ["meanMs", "max"]], run: echo },
  {
    row: "b2",
    id: "B2",
    variant: "4KiB",
    title: "terminal flood, 4 KiB frames",
    metrics: [["mibPerS", "min"]],
    run: (ctx) => flood(ctx, { kind: "binary", size: 4096, frames: Math.max(1, Math.round((256 * MIB * ctx.scale) / 4096)) }),
  },
  {
    row: "b2",
    id: "B2",
    variant: "64KiB",
    title: "terminal flood, 64 KiB frames",
    metrics: [["mibPerS", "min"]],
    run: (ctx) => flood(ctx, { kind: "binary", size: 65536, frames: Math.max(1, Math.round((256 * MIB * ctx.scale) / 65536)) }),
  },
  {
    row: "b2",
    id: "B2",
    variant: "256KiB",
    title: "terminal flood, 256 KiB frames",
    metrics: [["mibPerS", "min"]],
    run: (ctx) => flood(ctx, { kind: "binary", size: 262144, frames: Math.max(1, Math.round((256 * MIB * ctx.scale) / 262144)) }),
  },
  {
    row: "b3",
    id: "B3",
    variant: "",
    title: "many small frames",
    metrics: [["framesPerS", "min"]],
    run: (ctx) => flood(ctx, { kind: "text", size: 200, frames: scaled(200000, ctx.scale) }),
  },
  {
    row: "b4",
    id: "B4",
    variant: "",
    title: "download",
    metrics: [["mibPerS", "min"], ["memory.growthKiB", "max"]],
    run: (ctx) => flood(ctx, { kind: "binary", size: 32768, frames: Math.max(1, Math.round((GIB * ctx.scale) / 32768)), memory: true }),
  },
  { row: "b5", id: "B5", variant: "", title: "upload", metrics: [["mibPerS", "min"], ["bufferedAmountEnd", "max"]], run: upload },
  {
    row: "window",
    id: "W1",
    variant: "",
    title: "no acknowledgement: Rust stops reading at the window",
    bridgeOnly: true,
    metrics: [["heldBytes", "max"], ["serverFedMiB", "min"]],
    run: noAck,
  },
];
