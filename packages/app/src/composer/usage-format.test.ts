import { describe, it, expect } from "vitest";
import {
  formatTokens,
  formatCost,
  totalTokens,
  hasUsage,
  formatUsageLabel,
  usageBreakdown,
  deriveTone,
  resolveWindow,
  mostRelevantWindow,
  type ProviderUsageWindow,
} from "./usage-format.js";

// ─── number formatting ────────────────────────────────────────────────────────

describe("formatTokens", () => {
  it("formats sub-thousand, thousands, millions", () => {
    expect(formatTokens(950)).toBe("950");
    expect(formatTokens(1234)).toBe("1.2k");
    expect(formatTokens(1_500_000)).toBe("1.5M");
    expect(formatTokens(-5)).toBe("0");
  });
});

describe("formatCost", () => {
  it("formats USD to 2 dp", () => {
    expect(formatCost(0.0312)).toBe("$0.03");
    expect(formatCost(12.5)).toBe("$12.50");
  });
});

// ─── agent usage label + breakdown ────────────────────────────────────────────

describe("agent usage label", () => {
  it("hasUsage is false for empty/undefined", () => {
    expect(hasUsage(undefined)).toBe(false);
    expect(hasUsage({})).toBe(false);
    expect(hasUsage({ inputTokens: 1 })).toBe(true);
  });

  it("totalTokens sums input + output", () => {
    expect(totalTokens({ inputTokens: 800, outputTokens: 400 })).toBe(1200);
  });

  it("formats a full label 'Model · tokens · cost'", () => {
    const label = formatUsageLabel(
      { inputTokens: 800, outputTokens: 400, costUsd: 0.03, provider: "anthropic" },
      "Claude Sonnet",
    );
    expect(label).toBe("Claude Sonnet · 1.2k tokens · $0.03");
  });

  it("falls back to provider when no model label; omits missing segments", () => {
    expect(formatUsageLabel({ costUsd: 0.1, provider: "openai" })).toBe("openai · $0.10");
    expect(formatUsageLabel({ inputTokens: 10 })).toBe("10 tokens");
  });

  it("returns undefined when there is nothing to show", () => {
    expect(formatUsageLabel(undefined)).toBeUndefined();
    expect(formatUsageLabel({})).toBeUndefined();
  });

  it("breakdown lists only present rows", () => {
    const rows = usageBreakdown({ inputTokens: 800, outputTokens: 400, cachedTokens: 100, costUsd: 0.03 });
    expect(rows.map((r) => r.label)).toEqual(["Input tokens", "Output tokens", "Cached tokens", "Cost"]);
    expect(usageBreakdown(undefined)).toEqual([]);
  });
});

// ─── provider account usage ────────────────────────────────────────────────

describe("deriveTone", () => {
  it("maps used% to tone thresholds", () => {
    expect(deriveTone(95)).toBe("danger");
    expect(deriveTone(80)).toBe("warning");
    expect(deriveTone(50)).toBe("default");
    expect(deriveTone(null)).toBe("default");
  });
});

describe("resolveWindow", () => {
  it("derives usedPct from remainingPct and flags at-risk", () => {
    const w: ProviderUsageWindow = { label: "5h", remainingPct: 5, runsOutAt: "t", shortfallPct: 10 };
    const r = resolveWindow(w);
    expect(r.usedPct).toBe(95);
    expect(r.tone).toBe("danger");
    expect(r.atRisk).toBe(true);
  });

  it("respects an explicit tone", () => {
    expect(resolveWindow({ label: "w", usedPct: 95, tone: "ok" }).tone).toBe("ok");
  });
});

describe("mostRelevantWindow", () => {
  it("prefers an at-risk window", () => {
    const windows: ProviderUsageWindow[] = [
      { label: "weekly", usedPct: 99 },
      { label: "5h", usedPct: 40, runsOutAt: "t", shortfallPct: 5 },
    ];
    expect(mostRelevantWindow(windows)?.label).toBe("5h");
  });

  it("otherwise picks the highest used%", () => {
    const windows: ProviderUsageWindow[] = [
      { label: "a", usedPct: 30 },
      { label: "b", usedPct: 80 },
    ];
    expect(mostRelevantWindow(windows)?.label).toBe("b");
  });

  it("returns undefined for no windows", () => {
    expect(mostRelevantWindow([])).toBeUndefined();
  });
});
