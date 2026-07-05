/**
 * Append-only per-agent timeline store (features/timeline-streaming.md § Timeline model,
 * § Behavior). Rows persist alongside the agent record in `agents/{cwd}/{id}.json`.
 *
 * Key concepts:
 *  - **Epoch** — each run (`startTurn`) increments the epoch; rows within one epoch are ordered by
 *    monotonically-increasing `seq`.
 *  - **Source row** — one `AgentStreamEvent` mapped to one raw storage row (epoch + seq + timestamp
 *    owned by the daemon, never the provider).
 *  - **Projected item** — what a client renders. Multi-source events collapse: a tool-call lifecycle
 *    (status updates, result) is ONE projected item regardless of how many source rows it spans;
 *    adjacent assistant/reasoning chunks merge into one per run before counting toward the page limit.
 *  - **Page** — bounded at `DEFAULT_PAGE_SIZE` projected items; supports `direction:"before"|"after"`
 *    from an opaque cursor (encoded as base-10 `seq` string), with all paging fields.
 */

import type { AgentStreamEvent } from "@av-pi-studio/protocol";

export const DEFAULT_PAGE_SIZE = 200;

// ---------------------------------------------------------------------------
// Row types
// ---------------------------------------------------------------------------

export interface TimelineRow {
  epoch: number;
  seq: number;
  /** Daemon-owned canonical timestamp (ISO-8601). */
  timestamp: string;
  event: AgentStreamEvent;
}

/** Kind used for projection collapsing. */
function rowKind(event: AgentStreamEvent): "tool_call" | "assistant" | "other" {
  if (event.kind === "tool_call") return "tool_call";
  if (event.kind === "assistant_message" || event.kind === "reasoning") return "assistant";
  return "other";
}

// ---------------------------------------------------------------------------
// Projected item (client-visible unit)
// ---------------------------------------------------------------------------

export interface ToolCallItem {
  kind: "tool_call";
  callId?: string;
  sourceSeqStart: number;
  sourceSeqEnd: number;
  events: AgentStreamEvent[];
}

export interface AssistantItem {
  kind: "assistant";
  sourceSeqStart: number;
  sourceSeqEnd: number;
  events: AgentStreamEvent[];
}

export interface OtherItem {
  kind: "other";
  sourceSeq: number;
  event: AgentStreamEvent;
}

export type ProjectedItem = ToolCallItem | AssistantItem | OtherItem;

/** Collapse a contiguous slice of rows into projected items. */
export function projectRows(rows: TimelineRow[]): ProjectedItem[] {
  const items: ProjectedItem[] = [];
  let i = 0;
  while (i < rows.length) {
    const row = rows[i] as TimelineRow;
    const kind = rowKind(row.event);
    if (kind === "tool_call") {
      // Collect all rows sharing the same callId (or adjacent tool rows if no callId).
      const callId = row.event.kind === "tool_call" ? row.event.callId : undefined;
      const group: AgentStreamEvent[] = [row.event];
      let j = i + 1;
      while (j < rows.length) {
        const next = rows[j] as TimelineRow;
        if (rowKind(next.event) !== "tool_call") break;
        const nextCallId = next.event.kind === "tool_call" ? next.event.callId : undefined;
        if (callId !== undefined && nextCallId !== undefined && nextCallId !== callId) break;
        group.push(next.event);
        j++;
      }
      items.push({
        kind: "tool_call",
        callId,
        sourceSeqStart: row.seq,
        sourceSeqEnd: (rows[j - 1] as TimelineRow).seq,
        events: group,
      });
      i = j;
    } else if (kind === "assistant") {
      // Merge adjacent assistant/reasoning chunks.
      const group: AgentStreamEvent[] = [row.event];
      let j = i + 1;
      while (j < rows.length && rowKind((rows[j] as TimelineRow).event) === "assistant") {
        group.push((rows[j] as TimelineRow).event);
        j++;
      }
      items.push({
        kind: "assistant",
        sourceSeqStart: row.seq,
        sourceSeqEnd: (rows[j - 1] as TimelineRow).seq,
        events: group,
      });
      i = j;
    } else {
      items.push({ kind: "other", sourceSeq: row.seq, event: row.event });
      i++;
    }
  }
  return items;
}

// ---------------------------------------------------------------------------
// Cursor encoding
// ---------------------------------------------------------------------------

/** Encode a cursor from a sequence number (opaque string → base-10 decimal). */
export function encodeCursor(seq: number): string {
  return String(seq);
}

/** Decode a cursor; returns `undefined` for an invalid/absent cursor. */
export function decodeCursor(cursor: string | null | undefined): number | undefined {
  if (cursor === null || cursor === undefined || cursor === "") return undefined;
  const n = Number(cursor);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

// ---------------------------------------------------------------------------
// Page result
// ---------------------------------------------------------------------------

export interface SourceSeqRange {
  start: number;
  end: number;
}

export interface TimelinePage {
  items: ProjectedItem[];
  seqStart: number;
  seqEnd: number;
  sourceSeqRanges: SourceSeqRange[];
  collapsed: boolean;
  hasNewer: boolean;
  startCursor: string | null;
  endCursor: string | null;
}

// ---------------------------------------------------------------------------
// AgentTimelineStore
// ---------------------------------------------------------------------------

export class AgentTimelineStore {
  private rows: TimelineRow[] = [];
  private epoch = 0;
  private nextSeq = 0;
  private readonly now: () => string;

  constructor(opts: { initialRows?: TimelineRow[]; now?: () => string } = {}) {
    this.now = opts.now ?? (() => new Date().toISOString());
    if (opts.initialRows && opts.initialRows.length > 0) {
      this.rows = [...opts.initialRows];
      const last = this.rows[this.rows.length - 1] as TimelineRow;
      this.epoch = last.epoch;
      this.nextSeq = last.seq + 1;
    }
  }

  /** Start a new epoch (called when a new run begins). */
  startEpoch(): number {
    this.epoch++;
    return this.epoch;
  }

  /** Append one event, assigning the daemon-owned timestamp + monotonic seq. */
  append(event: AgentStreamEvent): TimelineRow {
    const row: TimelineRow = {
      epoch: this.epoch,
      seq: this.nextSeq++,
      timestamp: this.now(),
      event,
    };
    this.rows.push(row);
    return row;
  }

  currentEpoch(): number {
    return this.epoch;
  }

  allRows(): TimelineRow[] {
    return this.rows;
  }

  rowCount(): number {
    return this.rows.length;
  }

  /**
   * Truncate the timeline back to just before the user message identified by messageId.
   * The messageId corresponds to the `messageId` field in user_message stream events.
   * Returns the ISO timestamp of the last retained row, or undefined if nothing was retained.
   * (features/rewind.md § Wire contract)
   */
  truncateBeforeMessage(messageId: string): string | undefined {
    const idx = this.rows.findIndex((row) => {
      const event = row.event as Record<string, unknown>;
      return event.kind === "user_message" && event.messageId === messageId;
    });
    if (idx <= 0) {
      // Nothing to truncate or messageId not found — truncate all rows as safe fallback
      if (idx === 0) this.rows = [];
      return undefined;
    }
    this.rows = this.rows.slice(0, idx);
    const last = this.rows[this.rows.length - 1];
    return last?.timestamp;
  }

  /**
   * Return a bounded page of projected items.
   *
   * `direction:"after"` from cursor returns rows AFTER that seq (newer); `"before"` returns rows
   * BEFORE that seq (older). Without a cursor, `"after"` returns from the start; `"before"` from
   * the tail.
   */
  page(opts: {
    direction: "before" | "after";
    cursor?: string | null;
    limit?: number;
  }): TimelinePage {
    const limit = opts.limit ?? DEFAULT_PAGE_SIZE;
    const cursorSeq = decodeCursor(opts.cursor);
    const { direction } = opts;

    // Select the source-row window.
    let window: TimelineRow[];
    if (direction === "after") {
      const start = cursorSeq !== undefined ? this.rows.findIndex((r) => r.seq > cursorSeq) : 0;
      window = start === -1 ? [] : this.rows.slice(start);
    } else {
      // "before": rows strictly before cursorSeq, reversed then sliced by projected count.
      const end =
        cursorSeq !== undefined ? this.rows.findIndex((r) => r.seq >= cursorSeq) : this.rows.length;
      window = end === -1 ? [...this.rows] : this.rows.slice(0, end);
      // For "before" we project from the tail end.
      window = window.toReversed();
    }

    // Project and take at most `limit` items, tracking which source rows we consumed.
    const projected: ProjectedItem[] = [];
    const usedSeqs: number[] = [];

    // For "before" we reversed, so project then re-reverse at the end.
    const allProjected = projectRows(direction === "after" ? window : window.toReversed());
    const pageSlice =
      direction === "after" ? allProjected.slice(0, limit) : allProjected.slice(-limit);

    for (const item of pageSlice) {
      projected.push(item);
      if (item.kind === "tool_call") {
        usedSeqs.push(item.sourceSeqStart, item.sourceSeqEnd);
      } else if (item.kind === "assistant") {
        usedSeqs.push(item.sourceSeqStart, item.sourceSeqEnd);
      } else {
        usedSeqs.push(item.sourceSeq);
      }
    }

    if (projected.length === 0) {
      return {
        items: [],
        seqStart: 0,
        seqEnd: 0,
        sourceSeqRanges: [],
        collapsed: false,
        hasNewer: false,
        startCursor: null,
        endCursor: null,
      };
    }

    const minSeq = Math.min(...usedSeqs);
    const maxSeq = Math.max(...usedSeqs);

    // hasNewer: true when there are rows in the store with seq > maxSeq.
    const hasNewer = this.rows.some((r) => r.seq > maxSeq);

    // sourceSeqRanges: contiguous runs of source seqs covered by this page.
    const pageRows = this.rows.filter((r) => r.seq >= minSeq && r.seq <= maxSeq);
    const sourceSeqRanges = buildSeqRanges(pageRows.map((r) => r.seq));

    // collapsed: any projected item spans >1 source row.
    const collapsed = projected.some((item) =>
      item.kind === "tool_call"
        ? item.sourceSeqStart !== item.sourceSeqEnd
        : item.kind === "assistant"
          ? item.sourceSeqStart !== item.sourceSeqEnd
          : false,
    );

    return {
      items: projected,
      seqStart: minSeq,
      seqEnd: maxSeq,
      sourceSeqRanges,
      collapsed,
      hasNewer,
      startCursor: encodeCursor(minSeq),
      endCursor: encodeCursor(maxSeq),
    };
  }
}

function buildSeqRanges(sorted: number[]): SourceSeqRange[] {
  if (sorted.length === 0) return [];
  const ranges: SourceSeqRange[] = [];
  let start = sorted[0] as number;
  let end = start;
  for (let i = 1; i < sorted.length; i++) {
    const n = sorted[i] as number;
    if (n === end + 1) {
      end = n;
    } else {
      ranges.push({ start, end });
      start = n;
      end = n;
    }
  }
  ranges.push({ start, end });
  return ranges;
}
