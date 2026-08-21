/**
 * `placeAsksInRows` — decides *where* in the transcript each extension-UI dialog card renders
 * (sprint-068 follow-up: the real-`pi` ordering bug).
 *
 * Tasks 005–007 appended every card after the last persisted row. That is right only while the
 * dialog is the newest thing on screen — which is all the mock provider can produce, since each
 * `#ui` recipe ends the turn on the dialog. Against a real extension the turn *continues*: the
 * tool call returns, the agent writes a reply, and those rows land after a card that chronologically
 * preceded them, so the answered question renders below the response that consumed it.
 *
 * ## The one invariant
 *
 * **Rows never move relative to each other.** Their array order is the source of truth (daemon
 * append order) and nothing here may permute it — this is an *insertion* of cards into a fixed row
 * sequence, never a sort of the union. A sort would be actively dangerous: `timestamp` is optional
 * on every row kind, and one `undefined` (→ `NaN` comparison) is enough to make a comparator
 * inconsistent and scramble the whole transcript. Both inputs are already correctly ordered — rows
 * by append, `askLayout` by the SDK's `createdAt`/`requestId` comparator — so this is a linear
 * two-list merge, not a re-derivation of either order.
 *
 * ## Placement rules
 *
 * - A card goes before the first row **provably newer** than it (`rowTime > createdAt`, strict, so
 *   equal-millisecond ties put the row first deterministically — no jitter across re-renders).
 * - A row with **no** timestamp can never be the row a card is placed before — it is skipped, not
 *   treated as time zero. If no row is provably newer (e.g. every timestamp absent on a transcript
 *   hydrated by a code path predating the field), every card lands at the end: exactly the pre-fix
 *   behaviour. The degenerate case degrades to the old one instead of collapsing to index 0. A card
 *   whose own `createdAt` is unusable degrades the same way.
 * - Row timestamps can legitimately go **backwards** — an optimistic user row is stamped from the
 *   *local* clock while every other row carries the daemon's, and the two hosts need not agree.
 *   No monotonic clamp is applied, because one would provably never change the result: stopping at
 *   the *first* row newer than the card makes the decision purely prefix-based, and a clamp can
 *   only raise floors at or after that stopping point. (Written, tested, and removed — the test
 *   `"non-monotonic row timestamps"` pins the behaviour the clamp was meant to provide.)
 * - The § 06 `"more"` marker carries no time of its own; it stays glued immediately in front of the
 *   card it already precedes, so it travels with it.
 */

import type { TimelineRow } from "@pi-studio-ui/timeline/row-model.js";
import type { AskLayoutItem } from "./ask-list.js";

/** Epoch ms, or `null` when the value is absent/unparseable — matching `ask-list.ts`'s tolerance
 *  for the wire's `number | string` timestamps. */
function toEpochMs(value: number | string | undefined): number | null {
  if (value === undefined) return null;
  const ms = typeof value === "number" ? value : Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}

/**
 * `rows` and `askLayout` merged into one render sequence, preserving both input orders exactly.
 * Generic over the row/card wrappers so the caller keeps its own `ComposedItem` union — this module
 * decides ordering and nothing else.
 */
export function placeAsksInRows<T>(
  rows: readonly TimelineRow[],
  askLayout: readonly AskLayoutItem[],
  wrapRow: (row: TimelineRow) => T,
  wrapAsk: (item: AskLayoutItem) => T,
): T[] {
  if (askLayout.length === 0) return rows.map(wrapRow);

  const out: T[] = [];
  let rowIndex = 0;

  const flushRowsBefore = (cardTime: number | null) => {
    while (rowIndex < rows.length) {
      const row = rows[rowIndex];
      if (row === undefined) break;
      // `null` cardTime means "no usable time" — flush everything and append (see the header's
      // degrade-to-append rule).
      if (cardTime !== null) {
        const rowTime = toEpochMs(row.timestamp);
        // Stop at the first row provably newer than the card. `>` (not `>=`) is what makes an
        // exact tie put the row first, deterministically.
        if (rowTime !== null && rowTime > cardTime) break;
      }
      out.push(wrapRow(row));
      rowIndex++;
    }
  };

  for (const layoutItem of askLayout) {
    // The `"more"` marker has no identity in time — it rides in front of the next card, which is
    // the one that decides the position for both.
    if (layoutItem.kind === "more") {
      out.push(wrapAsk(layoutItem));
      continue;
    }
    // `askLayout` is ordered by the same key, so `rowIndex` only moves forward across the whole
    // loop — the merge stays linear and a later card can never be placed before an earlier one.
    flushRowsBefore(toEpochMs(layoutItem.item.entry.createdAt));
    out.push(wrapAsk(layoutItem));
  }

  for (; rowIndex < rows.length; rowIndex++) {
    const row = rows[rowIndex];
    if (row !== undefined) out.push(wrapRow(row));
  }
  return out;
}
