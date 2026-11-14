/**
 * Drain an agent's authoritative timeline across every page.
 *
 * `fetch_agent_timeline_request` is BOUNDED: the daemon returns at most `limit` projected items
 * (default 200, `timeline-store.ts` `DEFAULT_PAGE_SIZE`) and reports `hasNewer:true` when more rows
 * exist past the page — the contract is "clients page to completion" (`timeline-rpc.ts`). A single
 * `direction:"after"` fetch therefore returns the OLDEST page only, silently dropping the newest
 * messages of any conversation longer than the cap. That's what made restored history stop partway
 * through: the daemon's rehydrated timeline (rebuilt from Pi's session file) was complete, the UI
 * just never asked for the rest.
 */

import { flattenTimelineItems, type TimestampedEvent } from "./events.js";

/** The subset of `FetchAgentTimelineResponse` paging needs (structural, so tests need no wire types). */
export interface TimelinePageLike {
  items: readonly unknown[];
  hasNewer: boolean;
  endCursor?: string | null;
}

/**
 * Fetch forward from the start of the timeline until the daemon reports no newer rows, flattening
 * every page into one ordered `TimestampedEvent[]` ready for `applyStreamEvent` replay.
 *
 * `fetchPage` receives the cursor to resume from (`null` for the first page). Paging stops on
 * `hasNewer:false`, an empty page, or a cursor that fails to advance — the daemon's `endCursor` is
 * the page's max source seq and strictly increases while `hasNewer` holds, so a repeated or absent
 * cursor means a non-conforming response, not more history.
 */
export async function fetchTimelineEvents(
  fetchPage: (cursor: string | null) => Promise<TimelinePageLike>,
): Promise<TimestampedEvent[]> {
  const events: TimestampedEvent[] = [];
  let cursor: string | null = null;

  for (;;) {
    const page = await fetchPage(cursor);
    if (page.items.length === 0) return events;
    events.push(...flattenTimelineItems(page.items));
    if (!page.hasNewer) return events;

    const next = page.endCursor;
    if (typeof next !== "string" || next === cursor) return events;
    cursor = next;
  }
}
