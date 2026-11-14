/**
 * `mergeAskEntries` — combines an agent's pending and resolved extension-UI dialogs into one
 * ordered list (sprint-068/task-006, extended by task-007 for the recovered marker and the
 * past-four collapse). Uses the SDK's own ordering key — `createdAt`, `requestId` tie-break, the
 * same comparator `pendingForAgent`/`resolvedForAgent` already sort each list by — so a card never
 * reshuffles when it resolves: an entry's `createdAt`/`requestId` never changes when it moves from
 * `pending` into `resolved`, so re-sorting the union by that same key places it at the identical
 * slot regardless of which of the two source lists it currently lives in. Ordering comes from the
 * SDK's comparator, not a local invention — re-deriving one here is how a card would gain a second,
 * divergent order and start jumping on resolution.
 */

import type { AgentUiPendingEntry, AgentUiResolvedEntry } from "@av-pi-studio/client";

export type AskEntry =
  | { kind: "pending"; entry: AgentUiPendingEntry }
  | { kind: "resolved"; entry: AgentUiResolvedEntry };

/** Epoch ms or ISO string → epoch ms, matching `agent-ui-state.ts`'s own (unexported) helper. */
function normalizeTimestamp(value: number | string): number {
  return typeof value === "number" ? value : Date.parse(value);
}

function compareAskEntries(a: AskEntry, b: AskEntry): number {
  const aTime = normalizeTimestamp(a.entry.createdAt);
  const bTime = normalizeTimestamp(b.entry.createdAt);
  if (aTime !== bTime) return aTime - bTime;
  if (a.entry.requestId < b.entry.requestId) return -1;
  if (a.entry.requestId > b.entry.requestId) return 1;
  return 0;
}

export function mergeAskEntries(
  pending: readonly AgentUiPendingEntry[],
  resolved: readonly AgentUiResolvedEntry[],
): AskEntry[] {
  const combined: AskEntry[] = [
    ...pending.map((entry): AskEntry => ({ kind: "pending", entry })),
    ...resolved.map((entry): AskEntry => ({ kind: "resolved", entry })),
  ];
  return combined.toSorted(compareAskEntries);
}

/** Stable identity for a `AskEntry` across the transition from pending to resolved (both carry the
 *  same `requestId`) — the key a virtualizer/React list should key on. */
export function askEntryKey(item: AskEntry): string {
  return item.entry.requestId;
}
/** A pending entry recovered from a daemon snapshot (page reload, reconnect) rather than observed
 *  live — the SDK stamps `receivedAt` only on a live `agent_ui_request` (`agent-ui-state.ts`'s
 *  `reduceUiRequest`); a rehydrated entry carries none. This is exactly the § 06 "still waiting"
 *  marker's signal — no new state, just reading the field that already means it. Resolved entries
 *  are never "recovered" (the daemon serves no resolved history to rebuild one from), so this only
 *  takes a pending entry. */
export function isRecovered(entry: AgentUiPendingEntry): boolean {
  return entry.receivedAt === undefined;
}

/** § 06 "Past four": four pending cards render in full; the SDK's own comparator order decides
 *  which four (oldest first) — never a local reordering. Resolved cards are unaffected: task-006
 *  already collapses every resolved card unconditionally, so they never compete for the budget. */
export const FULL_CARD_LIMIT = 4;

export type AskLayoutItem =
  | { kind: "card"; item: AskEntry; collapsed: boolean }
  | { kind: "more"; count: number };

/**
 * Lays `merged` (already `mergeAskEntries`-ordered) into the exact render sequence: every card in
 * order, with a `{ kind: "more" }` marker spliced in right before the first card collapsed by the
 * limit — i.e. immediately after the last full pending card, matching § 06's "beneath the fourth".
 * `expanded` lifts the limit entirely once the user has clicked that marker; a card past the limit
 * always renders in full once `expanded` is true, and a freshly arriving pending card while
 * collapsed just raises the `more` marker's `count` (never reshuffles or auto-hides an existing
 * full card).
 */
export function layoutAskEntries(merged: readonly AskEntry[], expanded: boolean): AskLayoutItem[] {
  let pendingSeen = 0;
  const flagged = merged.map((item) => {
    if (item.kind !== "pending") return { item, collapsed: false };
    pendingSeen++;
    return { item, collapsed: !expanded && pendingSeen > FULL_CARD_LIMIT };
  });

  const collapsedCount = flagged.filter((f) => f.collapsed).length;
  const firstCollapsedIndex = flagged.findIndex((f) => f.collapsed);

  const out: AskLayoutItem[] = [];
  flagged.forEach((f, i) => {
    if (i === firstCollapsedIndex) out.push({ kind: "more", count: collapsedCount });
    out.push({ kind: "card", item: f.item, collapsed: f.collapsed });
  });
  return out;
}
