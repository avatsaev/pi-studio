import { describe, expect, it } from "vitest";
import type { AgentUiPendingEntry, AgentUiResolvedEntry } from "@av-pi-studio/client";
import type { TimelineRow } from "@pi-studio-ui/timeline/row-model.js";
import type { AskEntry, AskLayoutItem } from "./ask-list.js";
import { placeAsksInRows } from "./ask-placement.js";

function row(id: string, timestamp?: string): TimelineRow {
  return { kind: "system", id, text: id, ...(timestamp !== undefined ? { timestamp } : {}) };
}

function pendingCard(requestId: string, createdAt: number | string): AskLayoutItem {
  const entry = {
    requestId,
    agentId: "a1",
    method: "confirm",
    payload: {},
    createdAt,
    answerable: true,
  } satisfies AgentUiPendingEntry;
  return { kind: "card", item: { kind: "pending", entry } satisfies AskEntry, collapsed: false };
}

function resolvedCard(requestId: string, createdAt: number | string): AskLayoutItem {
  const entry = {
    requestId,
    agentId: "a1",
    method: "confirm",
    payload: {},
    createdAt,
    reason: "answered",
  } satisfies AgentUiResolvedEntry;
  return { kind: "card", item: { kind: "resolved", entry } satisfies AskEntry, collapsed: false };
}

/** Flattens a placement into comparable tokens: `r:<id>` for rows, `a:<requestId>`, `more:<n>`. */
function place(rows: readonly TimelineRow[], layout: readonly AskLayoutItem[]): string[] {
  return placeAsksInRows(
    rows,
    layout,
    (r) => `r:${r.id}`,
    (item) => (item.kind === "more" ? `more:${item.count}` : `a:${item.item.entry.requestId}`),
  );
}

const T = (n: number) => new Date(n).toISOString();

describe("placeAsksInRows — the row-order invariant", () => {
  it("never permutes rows, whatever the card timestamps are", () => {
    const rows = [row("r1", T(500)), row("r2", T(100)), row("r3"), row("r4", T(300))];
    const layout = [pendingCard("q1", 50), resolvedCard("q2", 400), pendingCard("q3", 10_000)];

    const result = place(rows, layout);

    expect(result.filter((t) => t.startsWith("r:"))).toEqual(["r:r1", "r:r2", "r:r3", "r:r4"]);
  });

  it("returns rows untouched when there are no cards", () => {
    const rows = [row("r1", T(100)), row("r2", T(200))];
    expect(place(rows, [])).toEqual(["r:r1", "r:r2"]);
  });

  it("emits every card exactly once", () => {
    const rows = [row("r1", T(100)), row("r2", T(200))];
    const layout = [pendingCard("q1", 150), pendingCard("q2", 150), pendingCard("q3", 999)];
    const result = place(rows, layout);
    expect(result.filter((t) => t.startsWith("a:"))).toEqual(["a:q1", "a:q2", "a:q3"]);
  });
});

describe("placeAsksInRows — chronological placement", () => {
  it("places a resolved card before rows that postdate it (the real-pi bug)", () => {
    // tool row starts, dialog is raised during the call, assistant replies after it resolves.
    const rows = [row("tool", T(1000)), row("assistant", T(3000))];
    const layout = [resolvedCard("ask", 2000)];

    expect(place(rows, layout)).toEqual(["r:tool", "a:ask", "r:assistant"]);
  });

  it("still appends a card that is newer than every row (the pre-fix common case)", () => {
    const rows = [row("r1", T(100)), row("r2", T(200))];
    expect(place(rows, [pendingCard("q1", 900)])).toEqual(["r:r1", "r:r2", "a:q1"]);
  });

  it("keeps multiple cards in layout order while interleaving", () => {
    const rows = [row("r1", T(100)), row("r2", T(500)), row("r3", T(900))];
    const layout = [resolvedCard("q1", 200), resolvedCard("q2", 600)];

    expect(place(rows, layout)).toEqual(["r:r1", "a:q1", "r:r2", "a:q2", "r:r3"]);
  });

  it("places a card older than every row at the very top", () => {
    const rows = [row("r1", T(500)), row("r2", T(600))];
    expect(place(rows, [resolvedCard("q1", 100)])).toEqual(["a:q1", "r:r1", "r:r2"]);
  });

  it("accepts epoch-ms and ISO createdAt identically", () => {
    const rows = [row("r1", T(1000)), row("r2", T(3000))];
    const asMs = place(rows, [resolvedCard("q", 2000)]);
    const asIso = place(rows, [resolvedCard("q", T(2000))]);
    expect(asMs).toEqual(["r:r1", "a:q", "r:r2"]);
    expect(asIso).toEqual(asMs);
  });
});

describe("placeAsksInRows — ties and non-monotonic clocks", () => {
  it("puts the row first on an exact timestamp tie, deterministically", () => {
    const rows = [row("r1", T(1000)), row("r2", T(2000))];
    const result = place(rows, [resolvedCard("q", 1000)]);
    expect(result).toEqual(["r:r1", "a:q", "r:r2"]);
    // Stable across repeated evaluation — no dependence on sort implementation.
    expect(place(rows, [resolvedCard("q", 1000)])).toEqual(result);
  });

  it("non-monotonic row timestamps place purely on the prefix, never reordering rows", () => {
    // r2 is stamped from a skewed clock, earlier than r1 despite arriving later. The card (2000)
    // predates r1 (5000), so it belongs at the top — and the skewed r2 must not drag it downwards.
    const rows = [row("r1", T(5000)), row("r2", T(1000)), row("r3", T(6000))];

    expect(place(rows, [resolvedCard("q", 2000)])).toEqual(["a:q", "r:r1", "r:r2", "r:r3"]);
  });

  it("a later card never lands before an earlier one under a backwards clock", () => {
    const rows = [row("r1", T(9000)), row("r2", T(1000))];
    const layout = [resolvedCard("q1", 500), resolvedCard("q2", 2000)];

    const result = place(rows, layout);
    expect(result.indexOf("a:q1")).toBeLessThan(result.indexOf("a:q2"));
    expect(result.filter((t) => t.startsWith("r:"))).toEqual(["r:r1", "r:r2"]);
  });
});

describe("placeAsksInRows — missing timestamps degrade to append", () => {
  it("appends every card when no row carries a timestamp", () => {
    const rows = [row("r1"), row("r2"), row("r3")];
    const layout = [resolvedCard("q1", 100), resolvedCard("q2", 200)];

    expect(place(rows, layout)).toEqual(["r:r1", "r:r2", "r:r3", "a:q1", "a:q2"]);
  });

  it("never places a card before an untimestamped row on that row's own account", () => {
    const rows = [row("r1", T(100)), row("untimed"), row("r3", T(9000))];
    expect(place(rows, [resolvedCard("q", 500)])).toEqual(["r:r1", "r:untimed", "a:q", "r:r3"]);
  });

  it("appends a card whose own createdAt is unparseable", () => {
    const rows = [row("r1", T(100)), row("r2", T(200))];
    expect(place(rows, [resolvedCard("q", "not-a-date")])).toEqual(["r:r1", "r:r2", "a:q"]);
  });
});

describe("placeAsksInRows — the § 06 more marker", () => {
  it("keeps the marker immediately in front of the card it precedes", () => {
    const rows = [row("r1", T(100)), row("r2", T(9000))];
    const layout: AskLayoutItem[] = [
      pendingCard("q1", 200),
      { kind: "more", count: 2 },
      pendingCard("q2", 300),
    ];

    expect(place(rows, layout)).toEqual(["r:r1", "a:q1", "more:2", "a:q2", "r:r2"]);
  });

  it("does not let the marker strand rows behind it", () => {
    const rows = [row("r1", T(100))];
    const layout: AskLayoutItem[] = [{ kind: "more", count: 1 }, pendingCard("q1", 50)];

    // The marker emits first (it has no time of its own), then the card resolves the position.
    expect(place(rows, layout)).toEqual(["more:1", "a:q1", "r:r1"]);
  });
});
