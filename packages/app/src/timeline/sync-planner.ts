// Reconnect sync planner — determines how to catch up after a disconnect.
// clean-room-scope/features/timeline-streaming.md § Client sync planning

export type FetchDirection = "before" | "after";

export type FetchRequest = {
  agentId: string;
  cursor: string | undefined;
  direction: FetchDirection;
  limit: number;
};

export type SyncPlanKind = "resume-from-cursor" | "fresh-tail";

export type SyncPlan = {
  kind: SyncPlanKind;
  fetchRequest: FetchRequest;
};

export const DEFAULT_PAGE_LIMIT = 200;

// Plan the first fetch on entry/resume.
// If a cursor exists → fetch direction=after to catch up without skipping mid-run rows.
// If no cursor → fetch the latest tail (direction=before, no cursor = latest).
export function planInitialSync(agentId: string, cursor: string | undefined): SyncPlan {
  if (cursor) {
    return {
      kind: "resume-from-cursor",
      fetchRequest: { agentId, cursor, direction: "after", limit: DEFAULT_PAGE_LIMIT },
    };
  }
  return {
    kind: "fresh-tail",
    fetchRequest: { agentId, cursor: undefined, direction: "before", limit: DEFAULT_PAGE_LIMIT },
  };
}

// After receiving a page with hasNewer=true, plan the next fetch.
export function planNextPage(agentId: string, endCursor: string): FetchRequest {
  return { agentId, cursor: endCursor, direction: "after", limit: DEFAULT_PAGE_LIMIT };
}

// A sync sequence is complete when the page returns hasNewer=false.
export type SyncProgress =
  | { done: false; nextRequest: FetchRequest }
  | { done: true };

export function advanceSyncProgress(agentId: string, endCursor: string, hasNewer: boolean): SyncProgress {
  if (!hasNewer) return { done: true };
  return { done: false, nextRequest: planNextPage(agentId, endCursor) };
}
