/**
 * Equivalence of the merged timeline store with the per-chunk store it replaced (sprint-150 /
 * task-003). `ReferenceStore` below is the pre-change implementation (one row per event, chunks
 * merged only when projecting), kept verbatim apart from renames. Random event scripts are fed to
 * both stores and random pages (direction, limit, cursor) are compared field by field.
 *
 * Two things are allowed to differ, and the test states exactly how:
 *  - an assistant item's `events` hold ONE merged event per stored row instead of one per chunk
 *    (the reference's events are merged with the same rule before comparing);
 *  - a cursor strictly inside a merged row returns that row whole instead of the chunks past the
 *    cursor, so the reference is asked with the cursor snapped to the row boundary.
 */

import { describe, expect, it } from "vitest";

import type { AgentStreamEvent } from "@av-pi-studio/protocol";

import {
  AgentTimelineStore,
  DEFAULT_PAGE_SIZE,
  decodeCursor,
  encodeCursor,
  type ProjectedItem,
  type SourceSeqRange,
  type TimelinePage,
} from "./timeline-store.js";

// ---------------------------------------------------------------------------
// Reference: the per-chunk store as it was before the change
// ---------------------------------------------------------------------------

interface RefRow {
  epoch: number;
  seq: number;
  timestamp: string;
  event: AgentStreamEvent;
}

function refKind(event: AgentStreamEvent): "tool_call" | "assistant" | "other" {
  if (event.kind === "tool_call") return "tool_call";
  if (event.kind === "assistant_message" || event.kind === "reasoning") return "assistant";
  return "other";
}

function refProject(rows: RefRow[]): ProjectedItem[] {
  const items: ProjectedItem[] = [];
  let i = 0;
  while (i < rows.length) {
    const row = rows[i] as RefRow;
    const kind = refKind(row.event);
    if (kind === "tool_call") {
      const callId = row.event.kind === "tool_call" ? row.event.callId : undefined;
      const group: AgentStreamEvent[] = [row.event];
      let j = i + 1;
      while (j < rows.length) {
        const next = rows[j] as RefRow;
        if (refKind(next.event) !== "tool_call") break;
        const nextCallId = next.event.kind === "tool_call" ? next.event.callId : undefined;
        if (callId !== undefined && nextCallId !== undefined && nextCallId !== callId) break;
        group.push(next.event);
        j++;
      }
      items.push({
        kind: "tool_call",
        callId,
        sourceSeqStart: row.seq,
        sourceSeqEnd: (rows[j - 1] as RefRow).seq,
        timestamp: row.timestamp,
        events: group,
      });
      i = j;
    } else if (kind === "assistant") {
      const group: AgentStreamEvent[] = [row.event];
      let j = i + 1;
      while (j < rows.length && refKind((rows[j] as RefRow).event) === "assistant") {
        group.push((rows[j] as RefRow).event);
        j++;
      }
      items.push({
        kind: "assistant",
        sourceSeqStart: row.seq,
        sourceSeqEnd: (rows[j - 1] as RefRow).seq,
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

function refSeqRanges(sorted: number[]): SourceSeqRange[] {
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

class ReferenceStore {
  private rows: RefRow[] = [];
  private epoch = 0;
  private nextSeq = 0;

  constructor(private readonly now: () => string) {}

  startEpoch(): void {
    this.epoch++;
  }

  append(event: AgentStreamEvent): void {
    this.rows.push({ epoch: this.epoch, seq: this.nextSeq++, timestamp: this.now(), event });
  }

  page(opts: {
    direction: "before" | "after";
    cursor?: string | null;
    limit?: number;
  }): TimelinePage {
    const limit = opts.limit ?? DEFAULT_PAGE_SIZE;
    const cursorSeq = decodeCursor(opts.cursor);
    const { direction } = opts;

    let window: RefRow[];
    if (direction === "after") {
      const start = cursorSeq !== undefined ? this.rows.findIndex((r) => r.seq > cursorSeq) : 0;
      window = start === -1 ? [] : this.rows.slice(start);
    } else {
      const end =
        cursorSeq !== undefined ? this.rows.findIndex((r) => r.seq >= cursorSeq) : this.rows.length;
      window = end === -1 ? [...this.rows] : this.rows.slice(0, end);
      window = window.toReversed();
    }

    const usedSeqs: number[] = [];
    const allProjected = refProject(direction === "after" ? window : window.toReversed());
    const projected =
      direction === "after" ? allProjected.slice(0, limit) : allProjected.slice(-limit);

    for (const item of projected) {
      if (item.kind === "other") usedSeqs.push(item.sourceSeq);
      else usedSeqs.push(item.sourceSeqStart, item.sourceSeqEnd);
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
    return {
      items: projected,
      seqStart: minSeq,
      seqEnd: maxSeq,
      sourceSeqRanges: refSeqRanges(
        this.rows.filter((r) => r.seq >= minSeq && r.seq <= maxSeq).map((r) => r.seq),
      ),
      collapsed: projected.some((item) =>
        item.kind === "other" ? false : item.sourceSeqStart !== item.sourceSeqEnd,
      ),
      hasNewer: this.rows.some((r) => r.seq > maxSeq),
      startCursor: encodeCursor(minSeq),
      endCursor: encodeCursor(maxSeq),
    };
  }
}

// ---------------------------------------------------------------------------
// Random scripts
// ---------------------------------------------------------------------------

type Op = { op: "epoch" } | { op: "append"; event: AgentStreamEvent };

/** mulberry32: a small seeded PRNG, so a failing seed reproduces. */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(rand: () => number, items: readonly T[]): T {
  return items[Math.floor(rand() * items.length)] as T;
}

function randomEvent(
  rand: () => number,
  state: { open: Map<string, number>; nextCall: number; nextCompaction: number },
): AgentStreamEvent {
  const roll = rand();
  const text = pick(rand, ["a", "bc", "def", " ", "ghij"]);
  if (roll < 0.34) {
    return pick<AgentStreamEvent>(rand, [
      { kind: "assistant_message", text },
      { kind: "assistant_message", text },
      { kind: "assistant_message", text },
      { kind: "assistant_message", text, messageId: "m1" },
      { kind: "assistant_message", text, messageId: "m2" },
      { kind: "assistant_message", final: true },
      { kind: "assistant_message", text, final: true },
    ]);
  }
  if (roll < 0.5) {
    return pick<AgentStreamEvent>(rand, [
      { kind: "reasoning", text },
      { kind: "reasoning", text },
      { kind: "reasoning", final: true },
    ]);
  }
  if (roll < 0.72) {
    // Tool-call lifecycles that interleave: start a call, advance one, or finish one.
    const live = [...state.open.keys()];
    if (live.length === 0 || (live.length < 3 && rand() < 0.4)) {
      const callId = `c${state.nextCall++}`;
      state.open.set(callId, 0);
      return {
        kind: "tool_call",
        callId,
        tool: { kind: "shell", command: "ls" },
        status: "started",
      };
    }
    const callId = pick(rand, live);
    if (rand() < 0.5) {
      return { kind: "tool_call", callId, tool: { kind: "shell" }, status: "running" };
    }
    state.open.delete(callId);
    return { kind: "tool_call", callId, tool: { kind: "shell" }, status: "completed" };
  }
  if (roll < 0.76) {
    // A call without an id: adjacent id-less tool rows group together.
    return { kind: "tool_call", tool: { kind: "shell" } };
  }
  if (roll < 0.84) {
    return pick<AgentStreamEvent>(rand, [
      { kind: "turn_started" },
      { kind: "turn_completed" },
      { kind: "turn_failed", error: "boom" },
      { kind: "turn_canceled" },
      { kind: "user_message", messageId: "u", text: "hi" },
    ]);
  }
  if (roll < 0.92) {
    const id = `k${state.nextCompaction}`;
    if (rand() < 0.5) return { kind: "compaction", compactionId: id, phase: "started" };
    state.nextCompaction++;
    return { kind: "compaction", compactionId: id, phase: "completed", summary: "s" };
  }
  return { kind: "error", message: "bad" };
}

function randomScript(seed: number): Op[] {
  const rand = prng(seed);
  const state = { open: new Map<string, number>(), nextCall: 0, nextCompaction: 0 };
  const length = 1 + Math.floor(rand() * 80);
  const ops: Op[] = [];
  for (let i = 0; i < length; i++) {
    if (rand() < 0.07) ops.push({ op: "epoch" });
    // Bursts make long chunk runs likely, as a real stream does.
    const burst = rand() < 0.3 ? 1 + Math.floor(rand() * 6) : 1;
    const event = randomEvent(rand, state);
    for (let b = 0; b < burst; b++) ops.push({ op: "append", event });
  }
  return ops;
}

// ---------------------------------------------------------------------------
// The merge rule, spelled out independently of the store
// ---------------------------------------------------------------------------

interface Run {
  seq: number;
  seqEnd: number;
  epoch: number;
  events: AgentStreamEvent[];
}

function isChunk(event: AgentStreamEvent): boolean {
  return event.kind === "assistant_message" || event.kind === "reasoning";
}

function messageIdOf(event: AgentStreamEvent): string | undefined {
  return event.kind === "assistant_message" ? event.messageId : undefined;
}

function sealed(event: AgentStreamEvent): boolean {
  return (event.kind === "assistant_message" || event.kind === "reasoning") && event.final === true;
}

/** Group a script's events into the rows the store must hold. */
function modelRuns(ops: Op[]): Run[] {
  const runs: Run[] = [];
  let epoch = 0;
  let seq = 0;
  for (const op of ops) {
    if (op.op === "epoch") {
      epoch++;
      continue;
    }
    const last = runs.at(-1);
    const lastEvent = last?.events.at(-1);
    if (
      last &&
      lastEvent &&
      last.epoch === epoch &&
      isChunk(op.event) &&
      lastEvent.kind === op.event.kind &&
      !sealed(lastEvent) &&
      messageIdOf(lastEvent) === messageIdOf(op.event)
    ) {
      last.events.push(op.event);
      last.seqEnd = seq;
    } else {
      runs.push({ seq, seqEnd: seq, epoch, events: [op.event] });
    }
    seq++;
  }
  return runs;
}

/** One event standing for a run of chunk events, text concatenated, `final` from the last one. */
function mergeRun(events: AgentStreamEvent[]): AgentStreamEvent {
  const first = events[0] as AgentStreamEvent;
  const last = events.at(-1) as AgentStreamEvent;
  if (events.length === 1) return first;
  if (first.kind !== "assistant_message" && first.kind !== "reasoning") return first;
  const texts = events.flatMap((e) =>
    (e.kind === "assistant_message" || e.kind === "reasoning") && e.text !== undefined
      ? [e.text]
      : [],
  );
  const merged = { ...first, text: texts.length > 0 ? texts.join("") : undefined };
  if (
    (last.kind === "assistant_message" || last.kind === "reasoning") &&
    last.final !== undefined
  ) {
    return { ...merged, final: last.final };
  }
  return merged;
}

/** Re-express the reference's per-chunk assistant items with one event per run. */
function expectedItems(items: ProjectedItem[], runs: Run[]): ProjectedItem[] {
  const runIndexBySeq = new Map<number, number>();
  runs.forEach((run, index) => {
    for (let s = run.seq; s <= run.seqEnd; s++) runIndexBySeq.set(s, index);
  });
  return items.map((item) => {
    if (item.kind !== "assistant") return item;
    const groups: AgentStreamEvent[][] = [];
    let previousRun = -1;
    item.events.forEach((event, i) => {
      const run = runIndexBySeq.get(item.sourceSeqStart + i) as number;
      if (run !== previousRun) groups.push([]);
      (groups.at(-1) as AgentStreamEvent[]).push(event);
      previousRun = run;
    });
    return { ...item, events: groups.map(mergeRun) };
  });
}

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

function clock(): () => string {
  let n = 0;
  return () => `t${n++}`;
}

function build(ops: Op[]): { subject: AgentTimelineStore; reference: ReferenceStore } {
  const subject = new AgentTimelineStore({ now: clock() });
  const reference = new ReferenceStore(clock());
  for (const op of ops) {
    if (op.op === "epoch") {
      subject.startEpoch();
      reference.startEpoch();
    } else {
      subject.append(op.event);
      reference.append(op.event);
    }
  }
  return { subject, reference };
}

type Direction = "before" | "after";

/** The cursor to ask the reference with so it returns the same whole rows the store does. */
function snapCursor(runs: Run[], direction: Direction, cursor: number): string | undefined {
  const straddled =
    direction === "after"
      ? runs.find((r) => r.seq <= cursor && cursor < r.seqEnd)
      : runs.find((r) => r.seq < cursor && cursor <= r.seqEnd);
  if (!straddled) return encodeCursor(cursor);
  const snapped = direction === "after" ? straddled.seq - 1 : straddled.seqEnd + 1;
  return snapped < 0 ? undefined : encodeCursor(snapped);
}

const SEEDS = 300;
const LIMITS = [1, 2, 3, 5, 8, 200];

describe("merged store vs per-chunk reference", () => {
  it("stores one row per run of the merge rule", () => {
    for (let seed = 1; seed <= SEEDS; seed++) {
      const ops = randomScript(seed);
      const { subject } = build(ops);
      const runs = modelRuns(ops);
      expect(
        subject.allRows().map((r) => ({ seq: r.seq, seqEnd: r.seqEnd, epoch: r.epoch })),
        `seed ${seed}`,
      ).toEqual(runs.map((r) => ({ seq: r.seq, seqEnd: r.seqEnd, epoch: r.epoch })));
    }
  });

  it("returns the same pages for random directions, limits and cursors", () => {
    for (let seed = 1; seed <= SEEDS; seed++) {
      const ops = randomScript(seed);
      const { subject, reference } = build(ops);
      const runs = modelRuns(ops);
      const total = ops.filter((o) => o.op === "append").length;
      const rand = prng(seed * 7919);

      for (let trial = 0; trial < 40; trial++) {
        const direction: Direction = rand() < 0.5 ? "before" : "after";
        const limit = pick(rand, LIMITS);
        // Absent, any event boundary (mid-row included), or past the end.
        const cursor = rand() < 0.15 ? undefined : Math.floor(rand() * (total + 3));
        const label = `seed ${seed} ${direction} cursor ${String(cursor)} limit ${limit}`;

        const actual = subject.page({
          direction,
          cursor: cursor === undefined ? undefined : encodeCursor(cursor),
          limit,
        });
        const snapped = cursor === undefined ? undefined : snapCursor(runs, direction, cursor);
        const expected = reference.page({ direction, cursor: snapped, limit });

        expect(actual, label).toEqual({
          ...expected,
          items: expectedItems(expected.items, runs),
        });
      }
    }
  });
});
