import { describe, expect, it } from "vitest";
import { compactionLabel, isCompactionPending } from "./compaction.js";
import type { CompactionRow } from "./row-model.js";

function row(over: Partial<CompactionRow>): CompactionRow {
  return { kind: "compaction", id: "r1", compactionId: "c1", phase: "started", ...over };
}

describe("compactionLabel", () => {
  it("started, with and without a reason", () => {
    expect(compactionLabel(row({ reason: "manual" }))).toBe("Compacting context… (manual)");
    expect(compactionLabel(row({}))).toBe("Compacting context…");
  });

  it("completed shows before → ~after, or just before when the estimate is absent", () => {
    const base = { phase: "completed" as const, tokensBefore: 168_000 };
    expect(compactionLabel(row({ ...base, estimatedTokensAfter: 14_000 }))).toBe(
      "Context compacted · 168k → ~14k",
    );
    expect(compactionLabel(row({ ...base }))).toBe("Context compacted · 168k before");
    expect(compactionLabel(row({ phase: "completed" }))).toBe("Context compacted");
  });

  it("keeps one decimal below 100k-style round numbers and trims a trailing zero", () => {
    const r = row({ phase: "completed", tokensBefore: 14_500, estimatedTokensAfter: 900 });
    expect(compactionLabel(r)).toBe("Context compacted · 14.5k → ~900");
  });

  it("labels automatic reasons, and a retrying overflow", () => {
    expect(compactionLabel(row({ reason: "threshold" }))).toBe(
      "Compacting context… (auto · threshold)",
    );
    expect(compactionLabel(row({ reason: "overflow", willRetry: true }))).toBe(
      "Compacting context… (auto · overflow · retrying turn)",
    );
  });

  it("failed and canceled", () => {
    expect(compactionLabel(row({ phase: "failed", error: "boom" }))).toBe(
      "Compaction failed: boom",
    );
    expect(compactionLabel(row({ phase: "failed" }))).toBe("Compaction failed");
    expect(compactionLabel(row({ phase: "canceled" }))).toBe("Compaction canceled");
  });
});

describe("isCompactionPending", () => {
  it("is true exactly while a started row exists", () => {
    expect(isCompactionPending([])).toBe(false);
    expect(isCompactionPending([row({})])).toBe(true);
    expect(isCompactionPending([row({ phase: "completed" }), row({ phase: "failed" })])).toBe(
      false,
    );
    expect(isCompactionPending([row({ phase: "completed" }), row({ compactionId: "c2" })])).toBe(
      true,
    );
  });
});
