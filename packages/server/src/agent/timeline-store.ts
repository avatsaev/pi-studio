/**
 * Append-only per-agent timeline store (features/timeline-streaming.md § Timeline model,
 * § Behavior). Rows persist alongside the agent record in `agents/{cwd}/{id}.json`.
 *
 * Key concepts:
 *  - **Epoch** — each run (`startTurn`) increments the epoch; rows within one epoch are ordered by
 *    monotonically-increasing `seq`.
 *  - **Sequence number** — every appended event takes the next `seq`, chunks included; it is what
 *    live `agent_stream` frames carry and what cursors encode.
 *  - **Source row** — what the store holds (epoch + `seq` range + timestamp owned by the daemon,
 *    never the provider). One event is one row, except that CONSECUTIVE `assistant_message` /
 *    `reasoning` chunks of one kind, one epoch and one message merge on append into the last row:
 *    its text grows in place and `seqEnd` follows the last chunk. A `final` chunk seals the row.
 *  - **Projected item** — what a client renders. Multi-source events collapse: a tool-call lifecycle
 *    (status updates, result) is ONE projected item regardless of how many source rows it spans;
 *    adjacent assistant/reasoning rows (a reasoning block then its answer) form one item before
 *    counting toward the page limit.
 *  - **Page** — bounded at `DEFAULT_PAGE_SIZE` projected items; supports `direction:"before"|"after"`
 *    from an opaque cursor (encoded as base-10 `seq` string), with all paging fields. `after c`
 *    returns the rows whose `seqEnd > c`, `before c` the rows whose `seq < c`; a row straddling `c`
 *    comes back whole. A page's `seqStart`/`seqEnd` are the lowest `seq` and highest `seqEnd` of its
 *    rows, so a client that keeps live frames with `seq > seqEnd` loses and repeats nothing.
 */

import type { AgentStreamEvent } from "@av-pi-studio/protocol";

export const DEFAULT_PAGE_SIZE = 200;

// ---------------------------------------------------------------------------
// Row types
// ---------------------------------------------------------------------------

export interface TimelineRow {
  epoch: number;
  /** Sequence number of the row's first event. */
  seq: number;
  /** Sequence number of the row's last event: `seq` for a single event, higher for merged chunks. */
  seqEnd: number;
  /** Daemon-owned canonical timestamp of the first event (ISO-8601). */
  timestamp: string;
  event: AgentStreamEvent;
}

/** What `append` reports about the event it took: its own identity, not that of the row it joined. */
export interface AppendedEvent {
  epoch: number;
  seq: number;
  timestamp: string;
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
  /** Timestamp of the group's first row (ISO-8601). */
  timestamp: string;
  events: AgentStreamEvent[];
}

export interface AssistantItem {
  kind: "assistant";
  sourceSeqStart: number;
  sourceSeqEnd: number;
  /** Timestamp of the group's first row (ISO-8601). */
  timestamp: string;
  events: AgentStreamEvent[];
}

export interface OtherItem {
  kind: "other";
  sourceSeq: number;
  timestamp: string;
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
        sourceSeqEnd: (rows[j - 1] as TimelineRow).seqEnd,
        timestamp: row.timestamp,
        events: group,
      });
      i = j;
    } else if (kind === "assistant") {
      // Group adjacent assistant/reasoning rows.
      const group: AgentStreamEvent[] = [row.event];
      let j = i + 1;
      while (j < rows.length && rowKind((rows[j] as TimelineRow).event) === "assistant") {
        group.push((rows[j] as TimelineRow).event);
        j++;
      }
      items.push({
        kind: "assistant",
        sourceSeqStart: row.seq,
        sourceSeqEnd: (rows[j - 1] as TimelineRow).seqEnd,
        timestamp: row.timestamp,
        events: group,
      });
      i = j;
    } else {
      items.push({ kind: "other", sourceSeq: row.seq, timestamp: row.timestamp, event: row.event });
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
      this.nextSeq = last.seqEnd + 1;
    }
  }

  /** Start a new epoch (called when a new run begins). */
  startEpoch(): number {
    this.epoch++;
    return this.epoch;
  }

  /**
   * Append one event, assigning the daemon-owned timestamp + monotonic seq. A chunk that directly
   * continues the last row (same epoch, see `mergeChunk`) grows that row instead of adding one; the
   * returned identity is always the new event's own, which is what its live frame carries.
   */
  append(event: AgentStreamEvent): AppendedEvent {
    const seq = this.nextSeq++;
    const timestamp = this.now();
    const last = this.rows[this.rows.length - 1];
    const merged = last?.epoch === this.epoch ? mergeChunk(last.event, event) : undefined;
    if (last && merged) {
      last.event = merged;
      last.seqEnd = seq;
    } else {
      this.rows.push({ epoch: this.epoch, seq, seqEnd: seq, timestamp, event });
    }
    return { epoch: this.epoch, seq, timestamp };
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
   * Unconditionally replace the entire row set (fork resync — features/conversation-fork.md §
   * Daemon: post-fork resync). Unlike the constructor's `initialRows` seeding, this always
   * replaces, including when the store is already populated, and accepts an empty array as a
   * legitimate result (forking to before the first user message). Epoch/seq continue from the
   * installed rows' maximum so the next `startEpoch()`/`append()` never collides with or rewinds
   * below them; an empty replacement resets both back to their initial state.
   */
  replaceRows(rows: TimelineRow[]): void {
    this.rows = [...rows];
    const last = this.rows[this.rows.length - 1];
    this.epoch = last?.epoch ?? 0;
    this.nextSeq = last ? last.seqEnd + 1 : 0;
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

    // Select the source-row window: rows `after` the cursor (by their last seq), or rows `before`
    // it (by their first seq), so a row straddling the cursor is returned whole.
    let window: TimelineRow[];
    if (direction === "after") {
      const start = cursorSeq !== undefined ? this.rows.findIndex((r) => r.seqEnd > cursorSeq) : 0;
      window = start === -1 ? [] : this.rows.slice(start);
    } else {
      const end =
        cursorSeq !== undefined ? this.rows.findIndex((r) => r.seq >= cursorSeq) : this.rows.length;
      window = end === -1 ? this.rows : this.rows.slice(0, end);
    }

    // Project, then keep the first `limit` items going forward or the last `limit` going back.
    const allProjected = projectRows(window);
    const projected =
      direction === "after" ? allProjected.slice(0, limit) : allProjected.slice(-limit);

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

    // Items are in seq order, so the page spans the first item's start to the last item's end.
    const first = projected[0] as ProjectedItem;
    const last = projected[projected.length - 1] as ProjectedItem;
    const minSeq = first.kind === "other" ? first.sourceSeq : first.sourceSeqStart;
    const maxSeq = last.kind === "other" ? last.sourceSeq : last.sourceSeqEnd;

    // hasNewer: true when the store holds events past the page's last one.
    const hasNewer = (this.rows[this.rows.length - 1] as TimelineRow).seqEnd > maxSeq;

    // sourceSeqRanges: contiguous runs of source seqs covered by this page.
    const pageRows = this.rows.filter((r) => r.seq >= minSeq && r.seqEnd <= maxSeq);
    const sourceSeqRanges = buildSeqRanges(pageRows);

    // collapsed: any projected item spans >1 source event.
    const collapsed = projected.some((item) =>
      item.kind === "other" ? false : item.sourceSeqStart !== item.sourceSeqEnd,
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

/** Contiguous runs of sequence numbers covered by `rows` (sorted by `seq`). */
function buildSeqRanges(rows: TimelineRow[]): SourceSeqRange[] {
  const ranges: SourceSeqRange[] = [];
  for (const row of rows) {
    const last = ranges.at(-1);
    if (last && row.seq === last.end + 1) {
      last.end = row.seqEnd;
    } else {
      ranges.push({ start: row.seq, end: row.seqEnd });
    }
  }
  return ranges;
}

function joinText(a: string | undefined, b: string | undefined): string | undefined {
  return a === undefined && b === undefined ? undefined : (a ?? "") + (b ?? "");
}

/**
 * The event `prev` becomes when `next` follows it directly, or `undefined` when `next` starts a new
 * row: only a chunk of the same kind (same message id for `assistant_message`) continues `prev`,
 * and a `final` chunk closes the block, so nothing continues it. Returns a new object: `prev` may
 * be the very object that was already broadcast.
 */
function mergeChunk(prev: AgentStreamEvent, next: AgentStreamEvent): AgentStreamEvent | undefined {
  if (prev.kind === "assistant_message" && next.kind === "assistant_message") {
    if (prev.final === true || prev.messageId !== next.messageId) return undefined;
    const merged: typeof prev = { ...prev, text: joinText(prev.text, next.text) };
    if (next.final !== undefined) merged.final = next.final;
    return merged;
  }
  if (prev.kind === "reasoning" && next.kind === "reasoning") {
    if (prev.final === true) return undefined;
    const merged: typeof prev = { ...prev, text: joinText(prev.text, next.text) };
    if (next.final !== undefined) merged.final = next.final;
    return merged;
  }
  return undefined;
}
