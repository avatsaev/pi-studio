// The benchmark's runner: asks Rust for the run's settings, runs every selected workload on every
// transport, `runs` times each, and hands `results.json`'s content to Rust (`bench_finish`), which
// writes it and exits. Nothing here waits for a person.

import { BASIS, hashWords } from "./frame.js";
import { median, round, timerResolutionMs } from "./stats.js";
import { TRANSPORTS } from "./transport.js";
import { WORKLOADS } from "./workloads.js";

const { invoke } = window.__TAURI__.core;

/** A run that takes longer than this is a failure (the slowest, B4 at 1 GiB, takes under a minute on a working path). */
const RUN_TIMEOUT_MS = 10 * 60 * 1000;


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
    schema: 1,
    startedAt: new Date().toISOString(),
    app: { name: "ipc-bench", tauri: config.tauriVersion, os: config.os, arch: config.arch, userAgent: navigator.userAgent, navigatorPlatform: navigator.platform },
    options: { runs: config.runs, only: config.only, scale: config.scale, corrupt: config.corrupt, swap: config.swap },
    timerResolutionMs: round(timerResolutionMs(), 4),
    crossOriginIsolated: window.crossOriginIsolated === true,
    pageHash: hashSpeed(),
    transports: {},
    problems: [],
    pageErrors: pageErrors,
    ok: false,
  };
  const ctxBase = { scale: config.scale, runTimeoutMs: RUN_TIMEOUT_MS, rss: () => invoke("bench_rss") };
  await progress(`page ready: ${navigator.userAgent}; timer step ${results.timerResolutionMs} ms; page hashes ${results.pageHash.mibPerS} MiB/s`);

  for (const transport of TRANSPORTS) {
    const entry = { label: transport.label, runs: [], summary: [] };
    results.transports[transport.id] = entry;
    const ctx = { ...ctxBase, transport, url: (path) => `ws://127.0.0.1:${config.port}${path}` };
    for (const workload of WORKLOADS) {
      if (!config.only.includes(workload.row)) continue;
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
        own.push(record);
        entry.runs.push(record);
        await progress(`  ${record.ok ? "ok" : "FAILED"} ${headline(record)}`);
      }
      entry.summary.push(summarizeRuns(workload, own));
    }
  }
  if (pageErrors.length > 0) results.problems.push(...pageErrors.map((e) => `page error: ${e}`));
  results.finishedAt = new Date().toISOString();
  results.ok = results.problems.length === 0 && Object.values(results.transports).every((t) => t.runs.length > 0 && t.runs.every((r) => r.ok));
  await invoke("bench_finish", { results });
}

function headline(record) {
  if (record.error) return record.error;
  if (record.medianMs !== undefined) return `median ${record.medianMs} ms, p99 ${record.p99Ms} ms, mean ${record.meanMs} ms`;
  const parts = [`${record.mibPerS} MiB/s`, `${record.framesPerS} frames/s`];
  if (record.memory) parts.push(`memory +${Math.round(record.memory.growthKiB / 1024)} MiB`);
  if (record.bufferedAmountEnd !== undefined) parts.push(`bufferedAmount at the end ${record.bufferedAmountEnd}`);
  if (!record.integrity.ok) parts.push(`${record.integrity.errorCount} integrity error(s)`);
  return parts.join(", ");
}


main().catch(async (error) => {
  const message = error && error.stack ? error.stack : String(error);
  await progress(`FATAL ${message}`);
  await invoke("bench_finish", { results: { schema: 1, ok: false, problems: [`the benchmark could not run: ${message}`] } });
});
