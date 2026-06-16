import { describe, expect, it } from "vitest";

import type { AgentStreamEvent } from "@av-pi-studio/protocol";

import {
  AgentTimelineStore,
  decodeCursor,
  encodeCursor,
  projectRows,
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
    expect(items[0]).toMatchObject({ kind: "assistant", sourceSeqStart: 0, sourceSeqEnd: 2 });
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
