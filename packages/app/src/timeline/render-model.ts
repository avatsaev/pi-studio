// Timeline render model — stable row id keying for the virtualized list.
// clean-room-scope/features/timeline-rendering.md § The render model

import type { TimelineRow, TimelineRowKind } from "./reducer.js";

// RenderItem wraps a TimelineRow with a stable key for the virtual list.
export type RenderItem = {
  key: string;
  index: number;
  row: TimelineRow;
  /** Block group id for collapsing consecutive assistant blocks. */
  blockGroupId?: string;
  blockIndex?: number;
};

// RenderSegment — split points for partial virtualization on web (older vs mounted vs live head).
export type SegmentKind = "virtualized-history" | "mounted-history" | "live-head";

export type RenderSegment = {
  kind: SegmentKind;
  items: RenderItem[];
};

// MOUNTED_WINDOW_MIN: minimum number of recent items to keep fully mounted.
export const MOUNTED_WINDOW_MIN = 50;

// Derive a stable render key for a timeline row.
export function renderKey(row: TimelineRow): string {
  return `${row.epochId}:${row.seqStart}:${row.rowId}`;
}

// Build an ordered list of RenderItems from the reducer's row list.
export function buildRenderItems(rows: readonly TimelineRow[]): RenderItem[] {
  return rows.map((row, index) => ({
    key: renderKey(row),
    index,
    row,
    blockGroupId: extractBlockGroupId(row),
    blockIndex: extractBlockIndex(row),
  }));
}

// Partition items into segments: the most recent ≥ MOUNTED_WINDOW_MIN items aligned on a
// user_message boundary form the mounted window; everything older is virtualized.
export function partitionSegments(items: RenderItem[]): RenderSegment[] {
  if (items.length <= MOUNTED_WINDOW_MIN) {
    return [{ kind: "mounted-history", items }];
  }
  // Find a user_message boundary ≥ MOUNTED_WINDOW_MIN from the end
  let cutIndex = items.length - MOUNTED_WINDOW_MIN;
  while (cutIndex > 0 && items[cutIndex]!.row.kind !== "user_message") {
    cutIndex--;
  }
  const virtualized = items.slice(0, cutIndex);
  const mounted = items.slice(cutIndex);
  const result: RenderSegment[] = [];
  if (virtualized.length > 0) result.push({ kind: "virtualized-history", items: virtualized });
  if (mounted.length > 0) result.push({ kind: "mounted-history", items: mounted });
  return result;
}

function extractBlockGroupId(row: TimelineRow): string | undefined {
  if (row.kind !== "assistant_message") return undefined;
  const payload = row.payload as { blockGroupId?: string } | null;
  return payload?.blockGroupId;
}

function extractBlockIndex(row: TimelineRow): number | undefined {
  if (row.kind !== "assistant_message") return undefined;
  const payload = row.payload as { blockIndex?: number } | null;
  return payload?.blockIndex;
}

// Height estimation for virtualized history placeholders (web only).
export const ESTIMATED_ROW_HEIGHT: Record<TimelineRowKind, number> = {
  user_message: 80,
  assistant_message: 120,
  thought: 48,
  tool_call: 56,
  todo_list: 72,
  activity_log: 36,
  compaction: 40,
  unknown: 40,
};

export function estimateRowHeight(kind: TimelineRowKind): number {
  return ESTIMATED_ROW_HEIGHT[kind] ?? 40;
}
