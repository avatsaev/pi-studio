// A first reading of the results: each candidate bridge against the baseline, row by row, with the
// pass column of `swe/features/desktop-transport-bridge.md` § 1 (decision P1). The worst of a row's
// runs counts. A row that does not pass is a finding, not a failure of the run: the exit code is about
// completeness and integrity (row B6) only.
//
// `results` is what `main.js` builds: `transports[id].summary` holds, per workload, `worst` (the
// worst run of each metric), `runs` and `okRuns`.

const MIB_PER_S_FLOOR = 40;
const B3_FRAMES_PER_S_FLOOR = 5000;
/** The spec's B4 bound on memory growth: the inbound window (8 MiB) plus 64 MiB, in KiB. */
const B4_GROWTH_LIMIT_KIB = (8 + 64) * 1024;
/** WebKit's timer steps by 1 ms: below this resolution the median and 99th percentile are usable, above it only the mean. */
const COARSE_TIMER_MS = 0.5;

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

/** The rows of the reading for every candidate. */
export function compare(results) {
  const rows = [];
  const base = results.transports.websocket;
  const coarse = typeof results.timerResolutionMs === "number" && results.timerResolutionMs >= COARSE_TIMER_MS;
  for (const [id, entry] of Object.entries(results.transports)) {
    if (id === "websocket") continue;
    for (const summary of entry.summary) {
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
          const growth = at("memory.growthKiB");
          rows.push(row(id, "B4", "", "memory growth KiB", growth, `at most ${B4_GROWTH_LIMIT_KIB}`, growth === null ? false : growth <= B4_GROWTH_LIMIT_KIB, baseline?.worst["memory.growthKiB"] ?? null));
          break;
        }
        case "B5": {
          const floor = Math.max(MIB_PER_S_FLOOR, (baseline?.worst.mibPerS ?? 0) / 2);
          rows.push(row(id, "B5", "", "MiB/s", at("mibPerS"), `at least ${round1(floor)} (half the baseline, and ${MIB_PER_S_FLOOR})`, atLeast(at("mibPerS"), floor), baseline?.worst.mibPerS ?? null));
          rows.push(row(id, "B5", "", "bufferedAmount at the end", at("bufferedAmountEnd"), "0", at("bufferedAmountEnd") === 0));
          break;
        }
        case "W1":
          rows.push(row(id, "W1", "", "bytes Rust holds without acknowledgements", at("heldBytes"), "just past 8 MiB; the server's sends stall", summary.okRuns === summary.runs));
          break;
        default:
          break;
      }
    }
    // B6 is every run of every workload: none may have a reordered, lost or changed frame.
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
