// A first reading of the results: each candidate bridge against the baseline, row by row, with the
// pass column of `swe/features/desktop-transport-bridge.md` § 1 (decision P1). The worst of a row's
// runs counts. A row that does not pass is a finding, not a failure of the run: the exit code is about
// completeness and integrity (row B6) only.
//
// `results` is what `main.js` builds: `transports[id].summary` holds, per workload, `worst` (the
// worst run of each metric), `runs` and `okRuns`.

const MIB_PER_S_FLOOR = 40;
const B3_FRAMES_PER_S_FLOOR = 5000;
/** B4's memory growth may exceed the baseline's growth in the same run by this much (P14: 64 MiB), in KiB. */
const B4_GROWTH_ALLOWANCE_KIB = 64 * 1024;
/** WebKit's timer steps by 1 ms: below this resolution the median and 99th percentile are usable, above it only the mean. */
const COARSE_TIMER_MS = 0.5;
/** The spec's inbound window (§ 3): 8 MiB, and the frame (4 KiB in row B8) Rust may read past it. */
const WINDOW_HELD_LIMIT_BYTES = 8 * 1024 * 1024 + 2 * 4096;
/** The most the proxy may hold between its two sockets: a write batch and a frame (`PROXY_HELD_LIMIT_BYTES` of `workloads.js`). */
const PROXY_HELD_LIMIT_BYTES = 512 * 1024;

const find = (entry, id, variant) => entry.summary.find((s) => s.id === id && s.variant === variant);

/** One row of the reading: what was measured, the rule, and whether it passed (`null`: nothing to judge). */
function row(transport, workload, variant, metric, value, rule, pass, baseline = null) {
  return { transport, workload: variant ? `${workload}/${variant}` : workload, metric, value, baseline, rule, pass };
}

function b1(transport, base, cand, coarse) {
  const rows = [];
  const delta = (key) => (typeof cand.worst[key] === "number" && typeof base.worst[key] === "number" ? cand.worst[key] - base.worst[key] : null);
  const mean = delta("meanMs");
  const median = delta("medianMs");
  const p99 = delta("p99Ms");
  const within = (d, limit) => (d === null ? null : d <= limit);
  rows.push(row(transport, "B1", "", "meanMs slower than the baseline", mean, "at most 1 ms where the timer is coarse", coarse ? within(mean, 1) : null, base.worst.meanMs));
  rows.push(row(transport, "B1", "", "medianMs slower than the baseline", median, "at most 1 ms", coarse ? null : within(median, 1), base.worst.medianMs));
  rows.push(row(transport, "B1", "", "p99Ms slower than the baseline", p99, "at most 5 ms", coarse ? null : within(p99, 5), base.worst.p99Ms));
  return rows;
}

/**
 * Row B4's memory: no more growth than the baseline's in the same run, plus 64 MiB (P14). The written bound assumed the
 * channel's window; a WebSocket in the webview misses it on Linux and Windows, so the baseline is the measure. Without a
 * baseline number in this run there is nothing to compare with, which is a failure like any missing number.
 */
function b4Memory(transport, growth, baselineGrowth) {
  const known = typeof baselineGrowth === "number";
  const limit = known ? baselineGrowth + B4_GROWTH_ALLOWANCE_KIB : null;
  const rule = known ? `at most ${limit} (the baseline's ${baselineGrowth} in this run, and 64 MiB)` : "at most the baseline's growth in the same run and 64 MiB (this run has no baseline growth)";
  return row(transport, "B4", "", "memory growth KiB", growth, rule, growth !== null && limit !== null && growth <= limit, known ? baselineGrowth : null);
}

/** Row B7: reported only (the spec: one socket is shared, as today). */
function b7(transport, summary, baseline) {
  const reported = "reported only (one socket is shared)";
  const at = (key) => (typeof summary.worst[key] === "number" ? summary.worst[key] : null);
  return [
    row(transport, "B7", "", "p99Ms of the echo while the download runs", at("p99Ms"), reported, null, baseline?.worst.p99Ms ?? null),
    row(transport, "B7", "", "meanMs of the echo while the download runs", at("meanMs"), reported, null, baseline?.worst.meanMs ?? null),
    row(transport, "B7", "", "download MiB/s while the echo runs", at("downloadMibPerS"), reported, null, baseline?.worst.downloadMibPerS ?? null),
  ];
}

/** Row B8, one window mode (`hide`, `minimise`): no loss and held bytes within the window pass or fail; the timers are reported (they decide P7). */
function b8(transport, summary) {
  const at = (key) => (typeof summary.worst[key] === "number" ? summary.worst[key] : null);
  const name = `B8/${summary.variant}`;
  const rows = [row(transport, name, "", "frames lost", at("lostFrames"), "none", at("lostFrames") === 0)];
  const held = at("heldBytes");
  if (held !== null) rows.push(row(transport, name, "", "bytes Rust held", held, `at most ${WINDOW_HELD_LIMIT_BYTES} (the window and a frame)`, held <= WINDOW_HELD_LIMIT_BYTES));
  const reported = "reported (decides P7)";
  rows.push(row(transport, name, "", "worker timer, latest fire ms", at("workerTimer.maxDelayMs"), reported, null));
  rows.push(row(transport, name, "", "page timer, latest fire ms", at("pageTimer.maxDelayMs"), reported, null));
  rows.push(row(transport, name, "", "Rust 2 s tick, latest tick ms", at("rustTick.maxDelayMs"), reported, null));
  rows.push(row(transport, name, "", "page catches up after the show, ms", at("catchUpMs"), reported, null));
  return rows;
}

/** The rows of the reading for every candidate. */
export function compare(results) {
  const rows = [];
  const base = results.transports.websocket;
  const coarse = typeof results.timerResolutionMs === "number" && results.timerResolutionMs >= COARSE_TIMER_MS;
  for (const [id, entry] of Object.entries(results.transports)) {
    // The baseline has no pass marks of the candidates' kind: it is read for B7 and B8, which are reports.
    const baselineOnly = id === "websocket";
    for (const summary of entry.summary) {
      if (baselineOnly && summary.id !== "B7" && summary.id !== "B8") continue;
      const baseline = base ? find(base, summary.id, summary.variant) : undefined;
      const worst = summary.worst;
      const at = (key) => (typeof worst[key] === "number" ? worst[key] : null);
      const atLeast = (value, floor) => (value === null ? false : value >= floor);
      switch (summary.id) {
        case "B1":
          if (baseline) rows.push(...b1(id, baseline, summary, coarse));
          break;
        case "B2":
          rows.push(row(id, "B2", summary.variant, "MiB/s", at("mibPerS"), `at least ${MIB_PER_S_FLOOR}`, atLeast(at("mibPerS"), MIB_PER_S_FLOOR), baseline?.worst.mibPerS ?? null));
          break;
        case "B3":
          rows.push(row(id, "B3", "", "frames/s", at("framesPerS"), `at least ${B3_FRAMES_PER_S_FLOOR}`, atLeast(at("framesPerS"), B3_FRAMES_PER_S_FLOOR), baseline?.worst.framesPerS ?? null));
          break;
        case "B4": {
          const floor = Math.max(MIB_PER_S_FLOOR, (baseline?.worst.mibPerS ?? 0) / 2);
          rows.push(row(id, "B4", "", "MiB/s", at("mibPerS"), `at least ${round1(floor)} (half the baseline, and ${MIB_PER_S_FLOOR})`, atLeast(at("mibPerS"), floor), baseline?.worst.mibPerS ?? null));
          rows.push(b4Memory(id, at("memory.growthKiB"), baseline?.worst["memory.growthKiB"]));
          break;
        }
        case "B5": {
          const floor = Math.max(MIB_PER_S_FLOOR, (baseline?.worst.mibPerS ?? 0) / 2);
          rows.push(row(id, "B5", "", "MiB/s", at("mibPerS"), `at least ${round1(floor)} (half the baseline, and ${MIB_PER_S_FLOOR})`, atLeast(at("mibPerS"), floor), baseline?.worst.mibPerS ?? null));
          rows.push(row(id, "B5", "", "bufferedAmount at the end", at("bufferedAmountEnd"), "0", at("bufferedAmountEnd") === 0));
          break;
        }
        case "W1":
          if (entry.proxy) {
            // A webview WebSocket has no acknowledgements to withhold: the page stops reading instead, and Rust must hold only a few frames.
            const held = at("heldBytes");
            const rule = `at most ${PROXY_HELD_LIMIT_BYTES} (a few frames) while the page reads nothing`;
            rows.push(row(id, "W1", "", "bytes Rust holds while the page reads nothing", held, rule, held !== null && held <= PROXY_HELD_LIMIT_BYTES && summary.okRuns === summary.runs));
          } else {
            rows.push(row(id, "W1", "", "bytes Rust holds without acknowledgements", at("heldBytes"), "just past 8 MiB; the server's sends stall", summary.okRuns === summary.runs));
          }
          break;
        case "B7":
          rows.push(...b7(id, summary, id === "websocket" ? undefined : baseline));
          break;
        case "B8":
          rows.push(...b8(id, summary));
          break;
        default:
          break;
      }
    }
    // B6 is every run of every workload: none may have a reordered, lost or changed frame.
    if (baselineOnly) continue;
    const damaged = entry.summary.filter((s) => s.okRuns !== s.runs);
    rows.push(row(id, "B6", "", "workloads with a damaged run", damaged.length, "none", damaged.length === 0));
  }
  return rows;
}

const round1 = (value) => Math.round(value * 10) / 10;

/** One line of the reading, for the progress stream. */
export function describe(r) {
  const verdict = r.pass === null ? "-   " : r.pass ? "PASS" : "FAIL";
  const base = r.baseline === null ? "" : ` (baseline ${round1(r.baseline)})`;
  const value = typeof r.value === "number" ? round1(r.value) : r.value;
  return `${verdict} ${r.transport} ${r.workload} ${r.metric}: ${value}${base}; ${r.rule}`;
}
