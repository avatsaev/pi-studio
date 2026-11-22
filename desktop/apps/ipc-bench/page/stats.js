// Small numeric helpers for the measurements.

/** The `p`-th percentile (0 to 100) of an ascending array, by nearest rank. */
export function percentile(sorted, p) {
  if (sorted.length === 0) return null;
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank - 1))];
}

/** Count, min, mean, median, 90th and 99th percentiles and max of a list of numbers. */
export function summarize(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  return {
    count: sorted.length,
    min: sorted[0] ?? null,
    mean: sorted.length ? sum / sorted.length : null,
    median: percentile(sorted, 50),
    p90: percentile(sorted, 90),
    p99: percentile(sorted, 99),
    max: sorted[sorted.length - 1] ?? null,
  };
}

export function median(values) {
  return percentile([...values].sort((a, b) => a - b), 50);
}

/** The smallest step `performance.now()` takes, in ms: WebKit rounds it, and a round trip under one step reads 0. */
export function timerResolutionMs() {
  let smallest = Infinity;
  const end = performance.now() + 50;
  let last = performance.now();
  for (let now = last; now < end; now = performance.now()) {
    if (now > last) {
      smallest = Math.min(smallest, now - last);
      last = now;
    }
  }
  return Number.isFinite(smallest) ? smallest : null;
}

export const round = (value, digits = 3) => (typeof value === "number" ? Number(value.toFixed(digits)) : value);
