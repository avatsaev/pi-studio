/**
 * Fork target correlation (sprint-072/task-002) — Timeline user rows and Pi's `forkMessages()`
 * entries live in disjoint id spaces (`swe/features/conversation-fork.md` § Ground truth): a live
 * `user_message` event's `messageId` is the client-minted `clientMessageId` echo (`row-model.ts`),
 * while Pi's `entryId` is its own JSONL entry id — nothing correlates them directly. Correlation
 * is therefore POSITIONAL: the clicked row's ordinal among the transcript's CONFIRMED user rows
 * equals the index into `forkMessages()`'s result, since both enumerate the active branch's user
 * messages chronologically. Verified by normalized-text equality before acting — any mismatch
 * (ordinal out of range, or disagreeing text) falls back to the picker rather than forking an
 * unverified entry (the task's own requirement — see `fork-gate.ts` for the separate, session-
 * level visibility gate this correlation sits behind).
 */

import type { TimelineRow, UserRow } from "@pi-studio-ui/timeline/row-model.js";

export interface ForkTarget {
  entryId: string;
  text: string;
}

export type ForkCorrelationResult =
  | { outcome: "matched"; target: ForkTarget }
  | { outcome: "fallback-to-picker" };

/** A user row that has been server-confirmed — never a `pending`/`failed` optimistic echo. Only
 * these rows are forkable (visual spec § 03) and only these participate in ordinal correlation. */
export function isConfirmedUserRow(row: TimelineRow): row is UserRow {
  return row.kind === "user" && !row.pending && !row.failed;
}

/** Confirmed user-row texts in transcript order — the domain `correlateForkTarget` indexes into. */
export function collectConfirmedUserRows(rows: readonly TimelineRow[]): string[] {
  return rows.filter(isConfirmedUserRow).map((row) => row.text);
}

/** Maps each confirmed user row's id to its ordinal (0-based, transcript order) — the same
 * ordinal space a row's click handler passes to `correlateForkTarget`. Only confirmed rows get an
 * entry, so a `pending`/`failed` row's id is never present here. */
export function buildConfirmedOrdinalByRowId(rows: readonly TimelineRow[]): Map<string, number> {
  const map = new Map<string, number>();
  let ordinal = 0;
  for (const row of rows) {
    if (!isConfirmedUserRow(row)) continue;
    map.set(row.id, ordinal);
    ordinal += 1;
  }
  return map;
}

/** Whitespace-insensitive text comparison — a wrapped/re-flowed message must still match. */
function normalize(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}

/**
 * Correlate `clickedIndex` (an ordinal into `confirmedUserRowTexts`, transcript order) against
 * `messages` (a fresh `forkMessages()` result, same order per Pi). Matches only when the ordinal
 * is in range for BOTH arrays AND the normalized texts agree; otherwise falls back to the picker.
 */
export function correlateForkTarget(
  confirmedUserRowTexts: readonly string[],
  clickedIndex: number,
  messages: readonly ForkTarget[],
): ForkCorrelationResult {
  const rowText = confirmedUserRowTexts[clickedIndex];
  const entry = messages[clickedIndex];
  if (rowText === undefined || entry === undefined) return { outcome: "fallback-to-picker" };
  if (normalize(rowText) !== normalize(entry.text)) return { outcome: "fallback-to-picker" };
  return { outcome: "matched", target: entry };
}
