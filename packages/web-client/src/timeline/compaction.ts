/**
 * Pure helpers over `CompactionRow` (sprint-074): the "is a compaction running" selector the
 * composer and status-bar meter gate on, and the divider's label text. No DOM, no store access.
 */

import type { CompactionRow, TimelineRow } from "./row-model.js";

/** True exactly while some compaction row is still `started`. */
export function isCompactionPending(rows: readonly TimelineRow[]): boolean {
  return rows.some((r) => r.kind === "compaction" && r.phase === "started");
}

/** The row of the compaction currently in progress, if any (first `started` one). */
export function pendingCompaction(rows: readonly TimelineRow[]): CompactionRow | undefined {
  return rows.find((r): r is CompactionRow => r.kind === "compaction" && r.phase === "started");
}

/** `168000` → `168k`, `14500` → `14.5k`, `2_000_000` → `2M`; one decimal, trailing zero trimmed. */
function formatCount(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${+(n / 1000).toFixed(1)}k`;
  return `${+(n / 1_000_000).toFixed(1)}M`;
}

function reasonLabel(row: CompactionRow): string | undefined {
  let label: string | undefined;
  if (row.reason === "manual") label = "manual";
  else if (row.reason === "threshold") label = "auto · threshold";
  else if (row.reason === "overflow") label = "auto · overflow";
  if (!label) return undefined;
  return row.willRetry ? `${label} · retrying turn` : label;
}

/** The divider's text for a row in any phase. */
export function compactionLabel(row: CompactionRow): string {
  const reason = reasonLabel(row);
  const suffix = reason ? ` (${reason})` : "";
  switch (row.phase) {
    case "started":
      return `Compacting context…${suffix}`;
    case "completed": {
      if (row.tokensBefore === undefined) return `Context compacted${suffix}`;
      const before = formatCount(row.tokensBefore);
      const detail =
        row.estimatedTokensAfter === undefined
          ? `${before} before`
          : `${before} → ~${formatCount(row.estimatedTokensAfter)}`;
      return `Context compacted · ${detail}${suffix}`;
    }
    case "failed":
      return `Compaction failed${row.error ? `: ${row.error}` : ""}${suffix}`;
    case "canceled":
      return `Compaction canceled${suffix}`;
  }
}
