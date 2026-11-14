import { describe, expect, it } from "vitest";
import type { AgentUiPendingEntry, AgentUiResolvedEntry } from "@av-pi-studio/client";
import { askEntryKey, isRecovered, layoutAskEntries, mergeAskEntries } from "./ask-list.js";

function pending(overrides: Partial<AgentUiPendingEntry> = {}): AgentUiPendingEntry {
  return {
    requestId: "req-1",
    agentId: "agent-1",
    method: "confirm",
    payload: {},
    createdAt: 1,
    answerable: true,
    ...overrides,
  };
}

function resolved(overrides: Partial<AgentUiResolvedEntry> = {}): AgentUiResolvedEntry {
  return {
    requestId: "req-1",
    agentId: "agent-1",
    method: "confirm",
    payload: {},
    createdAt: 1,
    reason: "answered",
    ...overrides,
  };
}

describe("mergeAskEntries", () => {
  it("orders entries oldest first by createdAt across both lists", () => {
    const merged = mergeAskEntries(
      [pending({ requestId: "b", createdAt: 20 }), pending({ requestId: "a", createdAt: 10 })],
      [resolved({ requestId: "c", createdAt: 5 })],
    );
    expect(merged.map((m) => m.entry.requestId)).toEqual(["c", "a", "b"]);
  });

  it("ties on createdAt break by requestId", () => {
    const merged = mergeAskEntries(
      [pending({ requestId: "b", createdAt: 10 }), pending({ requestId: "a", createdAt: 10 })],
      [],
    );
    expect(merged.map((m) => m.entry.requestId)).toEqual(["a", "b"]);
  });

  it("a card keeps its position when it moves from pending to resolved", () => {
    const older = pending({ requestId: "older", createdAt: 1 });
    const middle = pending({ requestId: "middle", createdAt: 2 });
    const newer = pending({ requestId: "newer", createdAt: 3 });

    const beforeResolution = mergeAskEntries([older, middle, newer], []);
    expect(beforeResolution.map((m) => m.entry.requestId)).toEqual(["older", "middle", "newer"]);

    // "middle" resolves — same createdAt/requestId, now sourced from `resolved` instead of `pending`.
    const afterResolution = mergeAskEntries(
      [older, newer],
      [resolved({ requestId: "middle", createdAt: 2 })],
    );
    expect(afterResolution.map((m) => m.entry.requestId)).toEqual(["older", "middle", "newer"]);
    expect(afterResolution[1]).toEqual({
      kind: "resolved",
      entry: resolved({ requestId: "middle", createdAt: 2 }),
    });
  });

  it("returns an empty list when both inputs are empty", () => {
    expect(mergeAskEntries([], [])).toEqual([]);
  });
});

describe("askEntryKey", () => {
  it("is the entry's requestId regardless of kind", () => {
    expect(askEntryKey({ kind: "pending", entry: pending({ requestId: "x" }) })).toBe("x");
    expect(askEntryKey({ kind: "resolved", entry: resolved({ requestId: "y" }) })).toBe("y");
  });
});
describe("isRecovered", () => {
  it("is true when a pending entry has no receivedAt (snapshot-rebuilt)", () => {
    expect(isRecovered(pending())).toBe(true);
  });

  it("is false when a pending entry carries a live receivedAt", () => {
    expect(isRecovered(pending({ receivedAt: 1000 }))).toBe(false);
  });
});

describe("layoutAskEntries", () => {
  function pendingList(n: number): AgentUiPendingEntry[] {
    return Array.from({ length: n }, (_, i) =>
      pending({ requestId: `req-${i}`, createdAt: i, method: `m${i}` }),
    );
  }

  it("renders four or fewer pending cards in full with no more-marker", () => {
    const merged = mergeAskEntries(pendingList(4), []);
    const layout = layoutAskEntries(merged, false);
    expect(layout).toHaveLength(4);
    expect(layout.every((l) => l.kind === "card" && !l.collapsed)).toBe(true);
  });

  it("collapses the fifth-and-later pending card and inserts a more-marker right before it", () => {
    const merged = mergeAskEntries(pendingList(6), []);
    const layout = layoutAskEntries(merged, false);
    // 4 full cards, 1 more-marker, 2 collapsed cards.
    expect(layout).toHaveLength(7);
    expect(layout.slice(0, 4).every((l) => l.kind === "card" && !l.collapsed)).toBe(true);
    expect(layout[4]).toEqual({ kind: "more", count: 2 });
    expect(layout.slice(5).every((l) => l.kind === "card" && l.collapsed)).toBe(true);
  });

  it("a resolved card never counts toward the pending budget or collapses", () => {
    const merged = mergeAskEntries(pendingList(4), [
      resolved({ requestId: "resolved-1", createdAt: -1 }),
    ]);
    // 4 pending (full) + 1 resolved (always collapsed by its own kind, not this budget).
    const layout = layoutAskEntries(merged, false);
    const cards = layout.filter((l) => l.kind === "card");
    expect(cards).toHaveLength(5);
    const collapsedPending = cards.filter(
      (c) => c.kind === "card" && c.item.kind === "pending" && c.collapsed,
    );
    expect(collapsedPending).toHaveLength(0);
  });

  it("expanded lifts the limit entirely — no marker, every card full", () => {
    const merged = mergeAskEntries(pendingList(6), []);
    const layout = layoutAskEntries(merged, true);
    expect(layout).toHaveLength(6);
    expect(layout.every((l) => l.kind === "card" && !l.collapsed)).toBe(true);
  });

  it("a new arrival while collapsed raises the marker's count without moving existing cards", () => {
    const before = layoutAskEntries(mergeAskEntries(pendingList(5), []), false);
    const after = layoutAskEntries(mergeAskEntries(pendingList(6), []), false);
    expect(before[4]).toEqual({ kind: "more", count: 1 });
    expect(after[4]).toEqual({ kind: "more", count: 2 });
    // The four full cards are identical and in the same order in both layouts.
    expect(before.slice(0, 4)).toEqual(after.slice(0, 4));
  });
});
