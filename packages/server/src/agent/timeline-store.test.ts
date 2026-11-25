import { describe, expect, it } from "vitest";

import type { AgentStreamEvent } from "@av-pi-studio/protocol";

import {
  AgentTimelineStore,
  decodeCursor,
  encodeCursor,
  projectRows,
  type TimelinePage,
  type TimelineRow,
} from "./timeline-store.js";

const NOW = "2026-06-11T12:00:00.000Z";
function store(rows?: TimelineRow[]): AgentTimelineStore {
  return new AgentTimelineStore({ initialRows: rows, now: () => NOW });
}

function ev(kind: AgentStreamEvent["kind"], extra: Record<string, unknown> = {}): AgentStreamEvent {
  if (kind === "tool_call")
    return { kind: "tool_call", tool: { kind: "shell" }, ...extra } as AgentStreamEvent;
  if (kind === "assistant_message")
    return { kind: "assistant_message", ...extra } as AgentStreamEvent;
  if (kind === "turn_started") return { kind: "turn_started" } as AgentStreamEvent;
  if (kind === "turn_completed") return { kind: "turn_completed" } as AgentStreamEvent;
  if (kind === "reasoning") return { kind: "reasoning" } as AgentStreamEvent;
  return { kind, ...extra } as unknown as AgentStreamEvent;
}

describe("sequencing + epoch", () => {
  it("assigns monotonic seqs within an epoch", () => {
    const s = store();
    const r1 = s.append(ev("turn_started"));
    const r2 = s.append(ev("assistant_message"));
    expect(r1.seq).toBe(0);
    expect(r2.seq).toBe(1);
    expect(r1.epoch).toBe(r2.epoch);
  });

  it("increments epoch on startEpoch()", () => {
    const s = store();
    const e0 = s.currentEpoch();
    s.startEpoch();
    const r = s.append(ev("turn_started"));
    expect(r.epoch).toBe(e0 + 1);
  });

  it("daemon-owns timestamps (not provider replay)", () => {
    const s = store();
    const row = s.append(ev("assistant_message"));
    expect(row.timestamp).toBe(NOW);
  });
});

describe("replaceRows (fork resync)", () => {
  it("replaces rows even when the store is already populated (unlike TimelineRegistry.seed's no-op)", () => {
    const s = store();
    s.append(ev("turn_started"));
    s.append(ev("assistant_message"));
    expect(s.rowCount()).toBe(2);

    const forked: TimelineRow[] = [
      { epoch: 5, seq: 9, seqEnd: 9, timestamp: NOW, event: ev("turn_started") },
    ];
    s.replaceRows(forked);
    expect(s.rowCount()).toBe(1);
    expect(s.allRows()).toEqual(forked);
  });

  it("accepts an empty replacement without throwing", () => {
    const s = store([{ epoch: 1, seq: 0, seqEnd: 0, timestamp: NOW, event: ev("turn_started") }]);
    expect(() => s.replaceRows([])).not.toThrow();
    expect(s.rowCount()).toBe(0);
  });

  it("continues epoch/seq numbering from the installed rows' maximum", () => {
    const s = store();
    s.replaceRows([
      { epoch: 3, seq: 7, seqEnd: 7, timestamp: NOW, event: ev("turn_started") },
      { epoch: 3, seq: 8, seqEnd: 8, timestamp: NOW, event: ev("assistant_message") },
    ]);
    s.startEpoch();
    const row = s.append(ev("turn_started"));
    expect(row.epoch).toBe(4);
    expect(row.seq).toBe(9);
  });

  it("resets epoch/seq to their initial state after an empty replacement", () => {
    const s = store([{ epoch: 3, seq: 7, seqEnd: 7, timestamp: NOW, event: ev("turn_started") }]);
    s.replaceRows([]);
    s.startEpoch();
    const row = s.append(ev("turn_started"));
    expect(row.epoch).toBe(1);
    expect(row.seq).toBe(0);
  });
});

describe("projection collapse", () => {
  it("collapses multiple tool_call source rows with the same callId into one item", () => {
    const s = store();
    s.append(ev("tool_call", { callId: "c1", tool: { kind: "shell", command: "ls" } }));
    s.append(
      ev("tool_call", { callId: "c1", tool: { kind: "shell", command: "ls" }, status: "done" }),
    );
    s.append(ev("assistant_message"));
    const items = projectRows(s.allRows());
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      kind: "tool_call",
      callId: "c1",
      sourceSeqStart: 0,
      sourceSeqEnd: 1,
      timestamp: NOW,
    });
    expect(items[0]?.kind === "tool_call" ? items[0].events.length : 0).toBe(2);
  });

  it("merges adjacent assistant/reasoning chunks into one projected item", () => {
    const s = store();
    s.append(ev("assistant_message", { text: "a" }));
    s.append(ev("reasoning", { text: "b" }));
    s.append(ev("assistant_message", { text: "c" }));
    s.append(ev("turn_completed"));
    const items = projectRows(s.allRows());
    expect(items).toHaveLength(2); // merged assistant + turn_completed
    expect(items[0]).toMatchObject({
      kind: "assistant",
      sourceSeqStart: 0,
      sourceSeqEnd: 2,
      timestamp: NOW,
    });
  });
});

describe("paging", () => {
  /** Produce n non-collapsible projected items (interleave turn markers). */
  function fill(n: number): AgentTimelineStore {
    const s = store();
    for (let i = 0; i < n; i++) {
      s.append(ev("turn_started"));
      s.append(ev("turn_completed"));
    }
    return s;
  }

  it("returns ≤ limit projected items with all paging fields", () => {
    const s = fill(5);
    const page = s.page({ direction: "after", limit: 3 });
    expect(page.items.length).toBe(3);
    expect(typeof page.seqStart).toBe("number");
    expect(typeof page.seqEnd).toBe("number");
    expect(page.sourceSeqRanges.length).toBeGreaterThan(0);
    expect(typeof page.collapsed).toBe("boolean");
  });

  it("hasNewer is true while rows exist after the page", () => {
    const s = fill(10); // 20 source rows → 20 projected items
    const page1 = s.page({ direction: "after", limit: 5 });
    expect(page1.hasNewer).toBe(true);
    const page2 = s.page({ direction: "after", cursor: page1.endCursor, limit: 20 });
    expect(page2.hasNewer).toBe(false);
  });

  it("direction:before from endCursor returns older items", () => {
    const s = fill(10);
    const halfCursor = encodeCursor(5);
    const before = s.page({ direction: "before", cursor: halfCursor, limit: 3 });
    expect(before.items.length).toBeLessThanOrEqual(3);
    expect(before.seqEnd).toBeLessThan(5);
  });

  it("cursor round-trips through encode/decode", () => {
    expect(decodeCursor(encodeCursor(42))).toBe(42);
    expect(decodeCursor(null)).toBeUndefined();
    expect(decodeCursor("bad")).toBeUndefined();
  });
});

function text(kind: "assistant_message" | "reasoning", t: string): AgentStreamEvent {
  return { kind, text: t };
}

/** The text of every assistant/reasoning event on a page, in order. */
function pageText(page: TimelinePage): string {
  return page.items
    .flatMap((item) => (item.kind === "assistant" ? item.events : []))
    .map((e) => (e.kind === "assistant_message" || e.kind === "reasoning" ? (e.text ?? "") : ""))
    .join("");
}

describe("merging chunks into one row", () => {
  it("holds 300 chunks of one message as one row with the whole sequence range", () => {
    const s = store();
    s.startEpoch();
    for (let i = 0; i < 300; i++) s.append(text("assistant_message", `w${i} `));
    expect(s.rowCount()).toBe(1);
    const row = s.allRows()[0] as TimelineRow;
    expect(row).toMatchObject({ seq: 0, seqEnd: 299, epoch: 1 });
    expect(row.event).toEqual({
      kind: "assistant_message",
      text: Array.from({ length: 300 }, (_, i) => `w${i} `).join(""),
    });
  });

  it("gives each chunk its own sequence number, timestamp and epoch in the append result", () => {
    let n = 0;
    const s = new AgentTimelineStore({ now: () => `t${n++}` });
    s.startEpoch();
    expect(s.append(text("assistant_message", "a"))).toEqual({ epoch: 1, seq: 0, timestamp: "t0" });
    expect(s.append(text("assistant_message", "b"))).toEqual({ epoch: 1, seq: 1, timestamp: "t1" });
    // The row keeps the first chunk's timestamp.
    expect(s.allRows()[0]).toMatchObject({ seq: 0, seqEnd: 1, timestamp: "t0" });
  });

  it("never changes an event that was appended (it was already broadcast)", () => {
    const s = store();
    const first = text("assistant_message", "a");
    s.append(first);
    s.append(text("assistant_message", "b"));
    expect(first).toEqual({ kind: "assistant_message", text: "a" });
  });

  it("starts a new row at a tool call, a kind change, a closed block or another epoch", () => {
    const s = store();
    s.startEpoch();
    s.append(text("reasoning", "think "));
    s.append(text("reasoning", "more"));
    s.append(text("assistant_message", "answer "));
    s.append(text("assistant_message", "one"));
    s.append(ev("tool_call", { callId: "c1", tool: { kind: "shell", command: "ls" } }));
    s.append(text("assistant_message", "after tool"));
    s.append({ kind: "assistant_message", final: true });
    s.append(text("assistant_message", "next block"));
    s.startEpoch();
    s.append(text("assistant_message", " new epoch"));
    expect(s.allRows().map((r) => [r.seq, r.seqEnd, r.epoch])).toEqual([
      [0, 1, 1], // reasoning
      [2, 3, 1], // assistant answer
      [4, 4, 1], // tool call
      [5, 6, 1], // text then its closing marker
      [7, 7, 1], // the next block
      [8, 8, 2], // new epoch
    ]);
    expect(s.allRows()[3]?.event).toEqual({
      kind: "assistant_message",
      text: "after tool",
      final: true,
    });
  });

  it("keeps chunks of different assistant message ids apart", () => {
    const s = store();
    s.append({ kind: "assistant_message", messageId: "m1", text: "a" });
    s.append({ kind: "assistant_message", messageId: "m1", text: "b" });
    s.append({ kind: "assistant_message", messageId: "m2", text: "c" });
    expect(s.allRows().map((r) => [r.seq, r.seqEnd])).toEqual([
      [0, 1],
      [2, 2],
    ]);
  });

  it("returns the text so far when fetched while a message is still streaming", () => {
    const s = store();
    s.startEpoch();
    s.append(text("assistant_message", "Hel"));
    s.append(text("assistant_message", "lo"));
    const page = s.page({ direction: "after" });
    expect(pageText(page)).toBe("Hello");
    expect(page).toMatchObject({ seqStart: 0, seqEnd: 1, hasNewer: false, collapsed: true });
    // A chunk that lands after the fetch has a higher seq than the page's `seqEnd`.
    expect(s.append(text("assistant_message", "!")).seq).toBeGreaterThan(page.seqEnd);
    expect(pageText(s.page({ direction: "after", cursor: page.endCursor }))).toBe("Hello!");
  });

  describe("a cursor in the middle of a merged row", () => {
    function streamed(): AgentTimelineStore {
      const s = store();
      s.startEpoch();
      s.append(ev("turn_started"));
      for (let i = 0; i < 6; i++) s.append(text("assistant_message", `${i}`));
      s.append(ev("tool_call", { callId: "c1", tool: { kind: "shell" } }));
      for (let i = 6; i < 9; i++) s.append(text("assistant_message", `${i}`));
      s.append(ev("turn_completed"));
      return s;
    }

    it("pages forward without losing or repeating text", () => {
      const s = streamed();
      for (let mid = 1; mid <= 5; mid++) {
        let cursor: string | null = encodeCursor(mid);
        let seen = "";
        for (;;) {
          const page = s.page({ direction: "after", cursor, limit: 1 });
          if (page.items.length === 0) break;
          seen += pageText(page);
          cursor = page.endCursor;
        }
        // The row holding `mid` comes back whole, then every later row once.
        expect(seen, `after ${mid}`).toBe("012345678");
      }
    });

    it("pages backward without losing or repeating text", () => {
      const s = streamed();
      for (let mid = 2; mid <= 6; mid++) {
        let cursor: string | null = encodeCursor(mid);
        let seen = "";
        for (;;) {
          const page = s.page({ direction: "before", cursor, limit: 1 });
          if (page.items.length === 0) break;
          seen = pageText(page) + seen;
          cursor = page.startCursor;
        }
        // Every row starting before `mid` once, the straddled one whole.
        expect(seen, `before ${mid}`).toBe("012345");
      }
    });
  });
});
