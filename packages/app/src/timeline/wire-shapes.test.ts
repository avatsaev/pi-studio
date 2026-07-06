/**
 * Regression test: real daemon wire shapes → rendered timeline rows.
 *
 * Captured from a live dev daemon (mock provider) round-trip:
 *   create agent → send "hello there" → fetch timeline.
 * Guards against the class of bug where the client mapper read the wrong
 * discriminant (`type` vs `kind`) or failed to unwrap grouped items, producing
 * only "unknown" rows and a blank chat.
 */

import { describe, it, expect } from "vitest";
import { streamEventToTimelineRow, EMPTY_TIMELINE, mergePageRows, type TimelineRow } from "./reducer.js";
import { buildRenderItems } from "./render-model.js";

// Exact items[] shape returned by fetch_agent_timeline_response.
const FETCH_ITEMS: unknown[] = [
  { kind: "other", sourceSeq: 0, event: { kind: "user_message", messageId: "m1", text: "hello there" } },
  { kind: "other", sourceSeq: 1, event: { kind: "turn_started", turnId: "t1" } },
  { kind: "assistant", sourceSeqStart: 2, sourceSeqEnd: 2, events: [{ kind: "assistant_message", messageId: "a1", text: "echo: hello there" }] },
  { kind: "other", sourceSeq: 3, event: { kind: "turn_completed", turnId: "t1" } },
];

function flattenFetchItems(items: unknown[]): TimelineRow[] {
  const rows: TimelineRow[] = [];
  let running = 0;
  for (const item of items) {
    const it = item as Record<string, unknown>;
    const base = (it["sourceSeq"] as number) ?? (it["sourceSeqStart"] as number) ?? running;
    const events = Array.isArray(it["events"]) ? (it["events"] as unknown[]) : it["event"] !== undefined ? [it["event"]] : [it];
    events.forEach((ev, j) => {
      const row = streamEventToTimelineRow(ev, { seq: base + j, source: "page" });
      if (row) rows.push(row);
      running = Math.max(running, base + j + 1);
    });
  }
  return rows;
}

describe("real daemon timeline wire shapes", () => {
  it("renders user + assistant messages with text (not 'unknown' rows)", () => {
    const rows = flattenFetchItems(FETCH_ITEMS);
    // Only the two message events become rows; turn_started/turn_completed are dropped.
    expect(rows.map((r) => r.kind)).toEqual(["user_message", "assistant_message"]);
    expect((rows[0]!.payload as { text?: string }).text).toBe("hello there");
    expect((rows[1]!.payload as { text?: string }).text).toBe("echo: hello there");

    const merged = mergePageRows(EMPTY_TIMELINE, {
      rows,
      seqStart: 0,
      seqEnd: 3,
      hasNewer: false,
    });
    const items = buildRenderItems(merged.rows);
    expect(items).toHaveLength(2);
    expect(items[0]!.row.kind).toBe("user_message");
    expect(items[1]!.row.kind).toBe("assistant_message");
  });

  it("maps a live stream event (discriminated on `kind`, no `type`)", () => {
    const row = streamEventToTimelineRow(
      { kind: "assistant_message", messageId: "a2", text: "live reply" },
      { seq: 5, source: "live" },
    );
    expect(row).not.toBeNull();
    expect(row!.kind).toBe("assistant_message");
    expect(row!.rowId).toBe("a2");
    expect((row!.payload as { text?: string }).text).toBe("live reply");
  });

  it("drops lifecycle events (turn_started/completed) — they are not rows", () => {
    expect(streamEventToTimelineRow({ kind: "turn_started", turnId: "t" }, { seq: 0, source: "live" })).toBeNull();
    expect(streamEventToTimelineRow({ kind: "turn_completed", turnId: "t" }, { seq: 0, source: "live" })).toBeNull();
  });
});
