// Timeline reducers: merge live stream rows with authoritative paged history.
// clean-room-scope/features/timeline-streaming.md § Behavior & Algorithms (client)
// clean-room-scope/features/timeline-rendering.md § The render model

export type TimelineRowKind =
  | "user_message"
  | "assistant_message"
  | "thought"
  | "tool_call"
  | "todo_list"
  | "activity_log"
  | "compaction"
  | "unknown";

export type TimelineRowSource = "live" | "page";

export type TimelineRow = {
  rowId: string;
  kind: TimelineRowKind;
  seqStart: number;
  seqEnd: number;
  source: TimelineRowSource;
  epochId: string;
  timestamp: number;
  payload: unknown;
};

export type TimelineGap = {
  afterSeq: number;
  beforeSeq: number;
};

// Maps a daemon stream/timeline event `kind` to the render-model row kind.
// Lifecycle events (turn_started/turn_completed/…) intentionally have no entry —
// they are not rendered as timeline rows.
export const STREAM_EVENT_ROW_KINDS: Record<string, TimelineRowKind> = {
  user_message: "user_message",
  assistant_message: "assistant_message",
  reasoning: "thought",
  thought: "thought",
  tool_call: "tool_call",
  todo_list: "todo_list",
  activity_log: "activity_log",
  compaction: "compaction",
};

/**
 * Convert a single daemon event (the inner `event` from an `agent_stream`
 * envelope, or an item's nested event from a timeline fetch) into a TimelineRow.
 * Returns null for non-renderable events (turn lifecycle, unknown kinds).
 *
 * The daemon discriminates events on `kind`; `type` is accepted as a legacy
 * fallback. `rowId` is derived from a stable identity field so streaming deltas
 * for the same message merge onto one row.
 */
export function streamEventToTimelineRow(
  event: unknown,
  opts: { seq: number; source: TimelineRowSource },
): TimelineRow | null {
  const e = (event ?? {}) as Record<string, unknown>;
  const kind = (e["kind"] ?? e["type"]) as string | undefined;
  if (!kind) return null;
  const rowKind = STREAM_EVENT_ROW_KINDS[kind];
  if (!rowKind) return null;
  const seq = opts.seq;
  const rowId =
    (e["rowId"] as string | undefined) ??
    (e["messageId"] as string | undefined) ??
    (e["toolCallId"] as string | undefined) ??
    (e["id"] as string | undefined) ??
    `${kind}:${seq}`;
  return {
    rowId,
    kind: rowKind,
    seqStart: seq,
    seqEnd: seq,
    source: opts.source,
    epochId: (e["epochId"] as string | undefined) ?? opts.source,
    timestamp: (e["timestamp"] as number | undefined) ?? Date.now(),
    payload: e,
  };
}

export type TimelineState = {
  rows: readonly TimelineRow[];
  gaps: readonly TimelineGap[];
  cursor: string | undefined;
  endCursor: string | undefined;
  hasNewer: boolean;
  epoch: string | undefined;
};

export const EMPTY_TIMELINE: TimelineState = {
  rows: [],
  gaps: [],
  cursor: undefined,
  endCursor: undefined,
  hasNewer: false,
  epoch: undefined,
};

export type PageResult = {
  rows: TimelineRow[];
  seqStart: number;
  seqEnd: number;
  hasNewer: boolean;
  startCursor?: string;
  endCursor?: string;
  collapsed?: boolean;
};

// Merge a fetched page into the timeline state. Pages are authoritative and replace any
// overlapping live rows in the same seq range (dedup by seqStart–seqEnd overlap).
export function mergePageRows(state: TimelineState, page: PageResult): TimelineState {
  const nonOverlapping = state.rows.filter(
    (row) => !overlaps(row.seqStart, row.seqEnd, page.seqStart, page.seqEnd),
  );
  const merged = sortRows([...nonOverlapping, ...page.rows.map((row) => ({ ...row, source: "page" as const }))]);
  const gaps = detectGaps(merged);
  return {
    rows: merged,
    gaps,
    cursor: page.startCursor ?? state.cursor,
    endCursor: page.endCursor ?? state.endCursor,
    hasNewer: page.hasNewer,
    epoch: state.epoch,
  };
}

// Apply a live stream row. Ignored if the same seqStart already exists from a page (authoritative wins).
export function applyLiveRow(state: TimelineState, row: TimelineRow): TimelineState {
  const alreadyPresent = state.rows.some(
    (existing) => existing.seqStart === row.seqStart && existing.source === "page",
  );
  if (alreadyPresent) return state;
  const deduped = state.rows.filter((existing) => existing.rowId !== row.rowId);
  const merged = sortRows([...deduped, { ...row, source: "live" as const }]);
  return { ...state, rows: merged, gaps: detectGaps(merged) };
}

// Compact an incremental delta update into an existing live row (streaming assistant text etc.)
export function compactDelta(state: TimelineState, rowId: string, deltaPayload: unknown, seqEnd: number): TimelineState {
  const rows = state.rows.map((row) =>
    row.rowId === rowId && row.source === "live"
      ? { ...row, payload: deltaPayload, seqEnd: Math.max(row.seqEnd, seqEnd) }
      : row,
  );
  return { ...state, rows };
}

export function detectGaps(rows: readonly TimelineRow[]): TimelineGap[] {
  if (rows.length < 2) return [];
  const gaps: TimelineGap[] = [];
  for (let i = 1; i < rows.length; i++) {
    const prev = rows[i - 1]!;
    const curr = rows[i]!;
    if (curr.seqStart > prev.seqEnd + 1) {
      gaps.push({ afterSeq: prev.seqEnd, beforeSeq: curr.seqStart });
    }
  }
  return gaps;
}

export function sortRows(rows: TimelineRow[]): TimelineRow[] {
  return [...rows].sort((a, b) => a.seqStart - b.seqStart || a.timestamp - b.timestamp);
}

function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart <= bEnd && bStart <= aEnd;
}
