// Run with `node --test 'apps/ipc-bench/page/*.test.mjs'` from `desktop/`.
import assert from "node:assert/strict";
import test from "node:test";
import { compare, describe } from "./compare.js";

const summary = (id, variant, worst, runs = 3, okRuns = 3) => ({ id, variant, title: id, runs, okRuns, worst, median: worst });

function results(candidate, baseline, timerResolutionMs = 1) {
  return { timerResolutionMs, transports: { websocket: { summary: baseline }, "bridge-x": { summary: candidate } } };
}

const baseline = [
  summary("B1", "", { medianMs: 0, p99Ms: 1, meanMs: 0.05 }),
  summary("B2", "64KiB", { mibPerS: 2000 }),
  summary("B3", "", { framesPerS: 800000 }),
  summary("B4", "", { mibPerS: 1600, "memory.growthKiB": 300000 }),
  summary("B5", "", { mibPerS: 90, bufferedAmountEnd: 0 }),
];

const find = (rows, workload, metric) => rows.find((r) => r.workload === workload && r.metric.startsWith(metric));

test("a candidate inside the thresholds passes every row; B1 is judged on the mean where the timer is coarse", () => {
  const candidate = [
    summary("B1", "", { medianMs: 1, p99Ms: 2, meanMs: 0.9 }),
    summary("B2", "64KiB", { mibPerS: 300 }),
    summary("B3", "", { framesPerS: 20000 }),
    summary("B4", "", { mibPerS: 900, "memory.growthKiB": 60000 }),
    summary("B5", "", { mibPerS: 60, bufferedAmountEnd: 0 }),
  ];
  const rows = compare(results(candidate, baseline));
  assert.ok(rows.every((r) => r.pass !== false), rows.filter((r) => r.pass === false).map(describe).join("\n"));
  assert.equal(find(rows, "B1", "meanMs").pass, true);
  assert.equal(find(rows, "B1", "medianMs").pass, null, "the median is not judged where the timer is coarse");
  assert.equal(find(rows, "B6", "workloads").pass, true);
});

test("each threshold can fail", () => {
  const candidate = [
    summary("B1", "", { medianMs: 3, p99Ms: 9, meanMs: 1.5 }),
    summary("B2", "256KiB", { mibPerS: 39.9 }),
    summary("B3", "", { framesPerS: 4999 }),
    summary("B4", "", { mibPerS: 700, "memory.growthKiB": 80 * 1024 }),
    summary("B5", "", { mibPerS: 44, bufferedAmountEnd: 5 }),
  ];
  const rows = compare(results(candidate, baseline));
  assert.equal(find(rows, "B1", "meanMs").pass, false);
  assert.equal(find(rows, "B2/256KiB", "MiB/s").pass, false);
  assert.equal(find(rows, "B3", "frames/s").pass, false);
  assert.equal(find(rows, "B4", "MiB/s").pass, false, "700 is below half of 1600");
  assert.equal(find(rows, "B4", "memory").pass, false);
  assert.equal(find(rows, "B5", "MiB/s").pass, false, "44 is below half of 90");
  assert.equal(find(rows, "B5", "bufferedAmount").pass, false);
});

test("where the timer is fine, the median and the 99th percentile decide B1", () => {
  const candidate = [summary("B1", "", { medianMs: 0.5, p99Ms: 7, meanMs: 0.4 })];
  const rows = compare(results(candidate, baseline, 0.005));
  assert.equal(find(rows, "B1", "meanMs").pass, null);
  assert.equal(find(rows, "B1", "medianMs").pass, true);
  assert.equal(find(rows, "B1", "p99Ms").pass, false);
});

test("B6 fails when a run of any workload was damaged; the window test passes with its integrity", () => {
  const candidate = [summary("B3", "", { framesPerS: 20000 }, 3, 2), summary("W1", "", { heldBytes: 8 * 1024 * 1024 + 100 }, 3, 3)];
  const rows = compare(results(candidate, baseline));
  assert.equal(find(rows, "B6", "workloads").pass, false);
  assert.equal(find(rows, "B6", "workloads").value, 1);
  assert.equal(find(rows, "W1", "bytes").pass, true);
});

test("a missing number is a failure, and the baseline is never judged", () => {
  const rows = compare(results([summary("B2", "4KiB", {})], baseline));
  assert.equal(find(rows, "B2/4KiB", "MiB/s").pass, false);
  assert.ok(rows.every((r) => r.transport === "bridge-x"));
});
