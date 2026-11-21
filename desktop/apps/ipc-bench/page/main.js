// The benchmark's runner: asks Rust for the run's settings, runs every selected workload on every
// transport, `runs` times each, and hands `results.json`'s content to Rust (`bench_finish`), which
// writes it and exits. Nothing here waits for a person.

import { BASIS, hashWords } from "./frame.js";
import { compare, describe } from "./compare.js";
import { median, round, timerResolutionMs } from "./stats.js";
import { TRANSPORTS } from "./transport.js";
import { WORKLOADS as BASE_WORKLOADS } from "./workloads.js";
import { LOAD_WORKLOADS } from "./load.js";

/** Every workload, in the order it runs: B1 to B5 and W1, then B7 and B8. */
const WORKLOADS = [...BASE_WORKLOADS, ...LOAD_WORKLOADS];

const { invoke } = window.__TAURI__.core;

/** A run that takes longer than this is a failure (the slowest, B4 at 1 GiB, takes under a minute on a working path). */
const RUN_TIMEOUT_MS = 10 * 60 * 1000;
/** A run that sees no frame and no end for this long has stalled: it fails with the transport's counters, at once. */
const STALL_MS = 30 * 1000;
/** Rust's byte window (`WINDOW_HIGH_BYTES` of the `net` crate): the other bound next to the message count. */
const WINDOW_MAX_BYTES = 8 * 1024 * 1024;

// Anything the page throws that no workload caught fails the run.
const pageErrors = [];
window.addEventListener("error", (event) => pageErrors.push(String(event.message)));
window.addEventListener("unhandledrejection", (event) => pageErrors.push(String(event.reason)));
const logElement = document.getElementById("log");

function progress(line) {
  logElement.textContent += `${line}\n`;
  return invoke("bench_progress", { line: `ipc-bench: ${line}` }).catch(() => {});
}

/** How fast this page hashes, in MiB/s: the checks cost the same in every transport, and this says how much. */
function hashSpeed() {
  const words = new Uint32Array(1024 * 1024);
  for (let i = 0; i < words.length; i++) words[i] = i * 2654435761;
  const start = performance.now();
  let sink = BASIS;
  for (let i = 0; i < 64; i++) sink ^= hashWords(words);
  const ms = performance.now() - start;
  return { mibPerS: round((64 * 4) / (ms / 1000), 0), sink };
}

/** One workload's runs, folded: the worst and the median of each metric the workload names. */
function summarizeRuns(workload, runs) {
  const good = runs.filter((r) => r.ok);
  const read = (run, path) => path.split(".").reduce((value, key) => (value === undefined || value === null ? value : value[key]), run);
  const worst = {};
  const med = {};
  for (const [metric, direction] of workload.metrics) {
    const values = good.map((r) => read(r, metric)).filter((v) => typeof v === "number");
    if (values.length === 0) continue;
    worst[metric] = direction === "max" ? Math.max(...values) : Math.min(...values);
    med[metric] = median(values);
  }
  return { id: workload.id, variant: workload.variant, title: workload.title, runs: runs.length, okRuns: good.length, worst, median: med };
}

async function main() {
  const config = await invoke("bench_config");
  const results = {
    schema: 2,
    startedAt: new Date().toISOString(),
    app: { name: "ipc-bench", tauri: config.tauriVersion, os: config.os, arch: config.arch, userAgent: navigator.userAgent, navigatorPlatform: navigator.platform, pageOrigin: location.origin },
    options: { runs: config.runs, only: config.only, scale: config.scale, corrupt: config.corrupt, swap: config.swap },
    // The two bounds on what the bridge candidates' Rust side holds unacknowledged (reading stops above either).
    bridge: { window: { maxBytes: WINDOW_MAX_BYTES, maxMessages: config.maxInflightMessages } },
    timerResolutionMs: round(timerResolutionMs(), 4),
    crossOriginIsolated: window.crossOriginIsolated === true,
    pageHash: hashSpeed(),
    transports: {},
    problems: [],
    pageErrors: pageErrors,
    ok: false,
  };
  // The harness commands a workload has running (a window it holds for 30 s): the stall watchdog does not call that a stall.
  let commandsRunning = 0;
  const invokeCounted = async (...args) => {
    commandsRunning++;
    try {
      return await invoke(...args);
    } finally {
      commandsRunning--;
    }
  };
  const ctxBase = {
    scale: config.scale,
    runTimeoutMs: RUN_TIMEOUT_MS,
    stallMs: STALL_MS,
    busy: () => commandsRunning > 0,
    rss: () => invoke("bench_rss"),
    invoke: invokeCounted,
  };
  await progress(`page ready: ${navigator.userAgent}; timer step ${results.timerResolutionMs} ms; page hashes ${results.pageHash.mibPerS} MiB/s`);

  for (const transport of TRANSPORTS) {
    const entry = { label: transport.label, proxy: transport.proxy === true, runs: [], summary: [] };
    results.transports[transport.id] = entry;
    const ctx = { ...ctxBase, transport, url: (path) => `ws://127.0.0.1:${config.port}${path}` };
    for (const workload of WORKLOADS) {
      if (!config.only.includes(workload.row)) continue;
      if (workload.candidatesOnly && !transport.bridge && !transport.proxy) continue;
      const name = workload.variant ? `${workload.id}/${workload.variant}` : workload.id;
      const own = [];
      for (let run = 1; run <= config.runs; run++) {
        await progress(`${transport.id} ${name} (${workload.title}) run ${run}/${config.runs}`);
        const record = { workload: workload.id, variant: workload.variant, run };
        try {
          Object.assign(record, await workload.run(ctx));
          record.ok = record.integrity.ok;
        } catch (error) {
          record.ok = false;
          record.error = error && error.message ? error.message : String(error);
        }
        // B6: the workload and the frame, as the spec asks, for every run.
        if (record.error) results.problems.push(`${transport.id} ${name} run ${run}: ${record.error}`);
        for (const e of record.integrity ? record.integrity.errors : []) {
          results.problems.push(`${transport.id} ${name} run ${run}: ${e.frame === null ? "stream" : `frame ${e.frame}`}: ${e.problem}`);
        }
        if (record.ipc) {
          record.ipcPath = record.ipc.ipcPath;
          record.outOfOrder = record.ipc.outOfOrder;
        }
        own.push(record);
        entry.runs.push(record);
        await progress(`  ${record.ok ? "ok" : "FAILED"} ${headline(record)}`);
      }
      entry.summary.push(summarizeRuns(workload, own));
    }
    entry.ipc = summarizeIpc(entry.runs);
  }
  if (pageErrors.length > 0) results.problems.push(...pageErrors.map((e) => `page error: ${e}`));
  results.comparison = compare(results);
  for (const line of results.comparison) await progress(describe(line));
  results.finishedAt = new Date().toISOString();
  const runCounts = Object.values(results.transports).map((t) => t.runs.length);
  results.ok = results.problems.length === 0 && runCounts.some((n) => n > 0) && Object.values(results.transports).every((t) => t.runs.every((r) => r.ok));
  await invoke("bench_finish", { results });
}

function headline(record) {
  if (record.error) return record.error;
  let path = "";
  if (record.ipc && record.ipc.maxMessagesInFlight !== undefined) {
    path = `; ipc ${record.ipc.ipcPath}, ${record.ipc.outOfOrder} out of order, peak ${record.ipc.maxMessagesInFlight} messages and ${record.ipc.maxOutstanding} bytes in flight`;
  } else if (record.ipc) {
    path = `; ${record.ipc.ipcPath}, Rust held at most ${record.ipc.maxOutstanding} bytes (to the server ${record.ipc.maxHeldToServer}), ${record.ipc.stalls} stalled writes, longest write ${record.ipc.maxWriteMs} ms`;
  }
  if (record.lostFrames !== undefined) {
    const held = record.heldBytes === null ? "Rust holds nothing (no bridge)" : `Rust held at most ${record.heldBytes} bytes`;
    const worker = record.workerTimer.maxDelayMs === null ? "no worker timer due" : `worker timer ${round(record.workerTimer.maxDelayMs, 0)} ms late at most`;
    const hidden = record.window.pageSawHidden ? "page saw hidden" : record.window.systemHidIt ? "page did not see hidden" : "the window system did not hide it";
    return `${record.lostFrames} frames lost, ${held}, caught up ${record.catchUpMs} ms after the show, ${worker}, page timer ${round(record.pageTimer.maxDelayMs, 0)} ms late at most, Rust tick ${round(record.rustTick.maxDelayMs, 0)} ms late at most (${hidden})${path}`;
  }
  if (record.medianMs !== undefined && record.downloadMibPerS !== undefined) {
    return `echo median ${record.medianMs} ms, p99 ${record.p99Ms} ms, mean ${record.meanMs} ms over ${record.trips} trips while the download ran at ${record.downloadMibPerS} MiB/s${path}`;
  }
  if (record.medianMs !== undefined) return `median ${record.medianMs} ms, p99 ${record.p99Ms} ms, mean ${record.meanMs} ms${path}`;
  if (record.heldBytes !== undefined && record.blockedMs !== undefined) {
    const stalled = record.stalled ? `the first stalled write came when the server had sent ${record.serverFedMiB} of ${record.serverFloodBytes / 1048576} MiB` : "no write to the page stalled";
    const memory = record.memory ? `, the app's memory +${Math.round(record.memory.growthKiB / 1024)} MiB` : "";
    return `page read nothing for ${record.blockedMs} ms: Rust held at most ${record.heldBytes} bytes, ${record.stalls} stalled writes (longest ${record.maxWriteMs} ms), ${stalled}${memory}${path}`;
  }
  if (record.heldBytes !== undefined) {
    return `Rust held ${record.heldBytes} bytes (window ${record.windowHighBytes}), the server sent ${record.serverFedMiB} of ${record.serverFloodBytes / 1048576} MiB while it stalled${path}`;
  }
  const parts = [`${record.mibPerS} MiB/s`, `${record.framesPerS} frames/s`];
  if (record.memory) parts.push(`memory +${Math.round(record.memory.growthKiB / 1024)} MiB`);
  if (record.bufferedAmountEnd !== undefined) parts.push(`bufferedAmount at the end ${record.bufferedAmountEnd}`);
  if (!record.integrity.ok) parts.push(`${record.integrity.errorCount} integrity error(s)`);
  return parts.join(", ") + path;
}

/** What a candidate's runs say about the IPC: the path of the raw bodies, the sends out of order, how messages were delivered. */
function summarizeIpc(runs) {
  const ipcs = runs.filter((r) => r.ipc).map((r) => r.ipc);
  if (ipcs.length === 0) return undefined;
  const sum = (key) => ipcs.reduce((total, ipc) => total + (ipc[key] ?? 0), 0);
  const max = (key) => Math.max(...ipcs.map((ipc) => ipc[key] ?? 0));
  if (ipcs.every((ipc) => ipc.framesToPage !== undefined)) {
    // The proxy: Rust's counters of the two sockets it pumps between.
    return {
      ipcPaths: [...new Set(ipcs.map((ipc) => ipc.ipcPath))],
      maxOutstandingBytes: max("maxOutstanding"),
      maxHeldToServerBytes: max("maxHeldToServer"),
      stalledWrites: sum("stalls"),
      maxWriteMs: max("maxWriteMs"),
      refusals: sum("refusals"),
      pageOrigins: [...new Set(ipcs.map((ipc) => ipc.pageOrigin))],
    };
  }
  return {
    ipcPaths: [...new Set(ipcs.map((ipc) => ipc.ipcPath))],
    rawBodies: sum("rawBodies"),
    jsonArrayBodies: sum("jsonArrayBodies"),
    outOfOrderSends: sum("outOfOrder"),
    maxEarlyFramesWaiting: max("maxWaiting"),
    channelMessagesEvaluated: sum("directMessages"),
    channelMessagesFetched: sum("fetchedMessages"),
    maxOutstandingBytes: max("maxOutstanding"),
    maxMessagesInFlight: max("maxMessagesInFlight"),
    messagePauses: sum("messagePauses"),
  };
}


main().catch(async (error) => {
  const message = error && error.stack ? error.stack : String(error);
  await progress(`FATAL ${message}`);
  await invoke("bench_finish", { results: { schema: 1, ok: false, problems: [`the benchmark could not run: ${message}`] } });
});
