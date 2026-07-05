import { describe, expect, it } from "vitest";

import {
  advanceSyncProgress,
  applyLiveRow,
  buildRenderItems,
  clearAnchorRow,
  compactDelta,
  DEFAULT_PAGE_LIMIT,
  detectGaps,
  dispatchRow,
  EMPTY_TIMELINE,
  estimateRowHeight,
  INITIAL_AUTOSCROLL_STATE,
  isKnownRowKind,
  mergePageRows,
  MOUNTED_WINDOW_MIN,
  onEntry,
  onJumpToBottom,
  onMessageSent,
  onRowsAdded,
  onScroll,
  onScrollComplete,
  partitionSegments,
  planInitialSync,
  planNextPage,
  renderKey,
  resolveRowGap,
  ROW_GAP_VALUES,
  safeKind,
  setAnchorRow,
  sortRows,
  type PageResult,
  type TimelineRow,
  type TimelineState,
} from "./index.js";

// ─── helpers ───────────────────────────────────────────────────────────────

function makeRow(partial: Partial<TimelineRow> & { seqStart: number }): TimelineRow {
  return {
    rowId: `row-${partial.seqStart}`,
    kind: "assistant_message",
    seqEnd: partial.seqStart,
    source: "live",
    epochId: "e1",
    timestamp: partial.seqStart * 1000,
    payload: {},
    ...partial,
  };
}

function makePage(rows: TimelineRow[], hasNewer: boolean): PageResult {
  const seqs = rows.map((row) => row.seqStart);
  return {
    rows,
    seqStart: Math.min(...seqs),
    seqEnd: Math.max(...seqs.map((_, i) => rows[i]!.seqEnd)),
    hasNewer,
    endCursor: `cursor:${Math.max(...seqs)}`,
    startCursor: `cursor:${Math.min(...seqs)}`,
  };
}

// ─── reducer ───────────────────────────────────────────────────────────────

describe("timeline reducer", () => {
  it("merges page rows and dedupes overlapping live rows", () => {
    const live = makeRow({ seqStart: 1, seqEnd: 3, source: "live", rowId: "live-1" });
    let state = applyLiveRow(EMPTY_TIMELINE, live);
    expect(state.rows).toHaveLength(1);
    const page = makePage([makeRow({ seqStart: 1, seqEnd: 3, source: "page", rowId: "page-1" })], false);
    state = mergePageRows(state, page);
    expect(state.rows).toHaveLength(1);
    expect(state.rows[0]!.source).toBe("page");
  });

  it("authoritative page row wins over live row for same seq range", () => {
    let state = applyLiveRow(EMPTY_TIMELINE, makeRow({ seqStart: 5, source: "live" }));
    const page = makePage([makeRow({ seqStart: 5, source: "page", rowId: "row-5-auth" })], false);
    state = mergePageRows(state, page);
    expect(state.rows.length).toBe(1);
    expect(state.rows[0]!.source).toBe("page");
  });

  it("live row is ignored if an authoritative page row already covers that seq", () => {
    const pageRow = makeRow({ seqStart: 3, source: "page" });
    const page = makePage([pageRow], false);
    let state = mergePageRows(EMPTY_TIMELINE, page);
    state = applyLiveRow(state, makeRow({ seqStart: 3, source: "live" }));
    expect(state.rows.length).toBe(1);
    expect(state.rows[0]!.source).toBe("page");
  });

  it("detects gaps between non-consecutive seq numbers", () => {
    const rows = [makeRow({ seqStart: 1, seqEnd: 2 }), makeRow({ seqStart: 5, seqEnd: 6 })];
    const gaps = detectGaps(rows);
    expect(gaps).toHaveLength(1);
    expect(gaps[0]).toEqual({ afterSeq: 2, beforeSeq: 5 });
  });

  it("compactDelta updates live row payload and extends seqEnd", () => {
    let state = applyLiveRow(EMPTY_TIMELINE, makeRow({ seqStart: 10, seqEnd: 10, rowId: "r10" }));
    state = compactDelta(state, "r10", { text: "streaming" }, 15);
    expect(state.rows[0]!.seqEnd).toBe(15);
    expect((state.rows[0]!.payload as { text: string }).text).toBe("streaming");
  });

  it("rows are always sorted by seqStart", () => {
    const unsorted = [makeRow({ seqStart: 5 }), makeRow({ seqStart: 2 }), makeRow({ seqStart: 8 })];
    const sorted = sortRows(unsorted);
    expect(sorted.map((r) => r.seqStart)).toEqual([2, 5, 8]);
  });
});

// ─── sync planner ──────────────────────────────────────────────────────────

describe("sync planner", () => {
  it("resumes with cursor using direction=after", () => {
    const plan = planInitialSync("agent-1", "cursor:50");
    expect(plan.kind).toBe("resume-from-cursor");
    expect(plan.fetchRequest.direction).toBe("after");
    expect(plan.fetchRequest.cursor).toBe("cursor:50");
    expect(plan.fetchRequest.limit).toBe(DEFAULT_PAGE_LIMIT);
  });

  it("fetches latest tail when no cursor exists", () => {
    const plan = planInitialSync("agent-1", undefined);
    expect(plan.kind).toBe("fresh-tail");
    expect(plan.fetchRequest.direction).toBe("before");
    expect(plan.fetchRequest.cursor).toBeUndefined();
  });

  it("advances to next page when hasNewer=true", () => {
    const result = advanceSyncProgress("a", "cursor:100", true);
    expect(result.done).toBe(false);
    if (!result.done) expect(result.nextRequest.cursor).toBe("cursor:100");
  });

  it("stops sync when hasNewer=false", () => {
    expect(advanceSyncProgress("a", "cursor:100", false)).toEqual({ done: true });
  });

  it("planNextPage uses direction=after", () => {
    expect(planNextPage("a", "cursor:77").direction).toBe("after");
  });
});

// ─── render model ──────────────────────────────────────────────────────────

describe("render model", () => {
  it("buildRenderItems produces stable keys and preserves order", () => {
    const rows = [makeRow({ seqStart: 1 }), makeRow({ seqStart: 3 }), makeRow({ seqStart: 5 })];
    const items = buildRenderItems(rows);
    expect(items.map((i) => i.index)).toEqual([0, 1, 2]);
    expect(items.map((i) => i.key)).toEqual(rows.map((r) => renderKey(r)));
  });

  it("partitionSegments keeps all items mounted when below MOUNTED_WINDOW_MIN", () => {
    const rows = Array.from({ length: 10 }, (_, i) => makeRow({ seqStart: i + 1 }));
    const items = buildRenderItems(rows);
    const segs = partitionSegments(items);
    expect(segs).toHaveLength(1);
    expect(segs[0]!.kind).toBe("mounted-history");
  });

  it("partitionSegments virtualizes older items aligned on user_message boundary when above MOUNTED_WINDOW_MIN", () => {
    const rows = [
      ...Array.from({ length: 30 }, (_, i) => makeRow({ seqStart: i + 1, kind: "assistant_message" })),
      makeRow({ seqStart: 31, kind: "user_message" }),
      ...Array.from({ length: MOUNTED_WINDOW_MIN }, (_, i) => makeRow({ seqStart: 32 + i, kind: "assistant_message" })),
    ];
    const items = buildRenderItems(rows);
    const segs = partitionSegments(items);
    expect(segs.some((s) => s.kind === "virtualized-history")).toBe(true);
    expect(segs.some((s) => s.kind === "mounted-history")).toBe(true);
  });

  it("estimateRowHeight returns a positive number for all known kinds", () => {
    const kinds: Array<Parameters<typeof estimateRowHeight>[0]> = ["user_message", "assistant_message", "thought", "tool_call", "todo_list", "activity_log", "compaction", "unknown"];
    for (const kind of kinds) expect(estimateRowHeight(kind)).toBeGreaterThan(0);
  });
});

// ─── row dispatch ──────────────────────────────────────────────────────────

describe("row dispatch", () => {
  it("dispatches all known row kinds to non-empty component names", () => {
    const kinds = ["user_message", "assistant_message", "thought", "tool_call", "todo_list", "activity_log", "compaction"] as const;
    for (const kind of kinds) {
      const renderer = dispatchRow(kind);
      expect(renderer.component).toBeTruthy();
      expect(renderer.maxWidth).toBeGreaterThan(0);
    }
  });

  it("falls back to UnknownRowFallback for unknown kind", () => {
    expect(safeKind("future_kind")).toBe("unknown");
    expect(dispatchRow("unknown").component).toBe("UnknownRowFallback");
  });

  it("isKnownRowKind distinguishes registered kinds from unknown", () => {
    expect(isKnownRowKind("user_message")).toBe(true);
    expect(isKnownRowKind("not_a_real_kind")).toBe(false);
  });

  it("resolveRowGap applies packed gap for tool-seq rows", () => {
    expect(resolveRowGap("tool_call", "tool_call")).toBe(ROW_GAP_VALUES["tool-seq-packed"]);
    expect(resolveRowGap("user_message", "user_message")).toBe(ROW_GAP_VALUES["user-to-user"]);
    expect(resolveRowGap("user_message", "tool_call")).toBe(ROW_GAP_VALUES["user-to-tool"]);
    expect(resolveRowGap("assistant_message", "tool_call")).toBe(ROW_GAP_VALUES["assistant-tool"]);
    expect(resolveRowGap("assistant_message", "assistant_message")).toBe(ROW_GAP_VALUES.default);
  });
});

// ─── autoscroll state machine ───────────────────────────────────────────────

describe("autoscroll state machine", () => {
  it("starts in sticky-bottom and scrolls on new rows", () => {
    const result = onRowsAdded(INITIAL_AUTOSCROLL_STATE);
    expect(result.mode).toBe("sticky-bottom");
    expect(result.shouldScroll).toBe(true);
  });

  it("detaches when user scrolls up past threshold and shows jump button", () => {
    const s1 = onScroll(INITIAL_AUTOSCROLL_STATE, 200);
    expect(s1.mode).toBe("detached");
    expect(s1.showJumpButton).toBe(true);
  });

  it("re-attaches when user scrolls back near bottom", () => {
    const detached = onScroll(INITIAL_AUTOSCROLL_STATE, 200);
    const reattached = onScroll(detached, 20);
    expect(reattached.mode).toBe("sticky-bottom");
    expect(reattached.showJumpButton).toBe(false);
  });

  it("does not scroll new rows when detached", () => {
    const detached = onScroll(INITIAL_AUTOSCROLL_STATE, 300);
    const result = onRowsAdded(detached);
    expect(result.shouldScroll).toBe(false);
  });

  it("onEntry resets to sticky-bottom and triggers scroll", () => {
    const detached = onScroll(INITIAL_AUTOSCROLL_STATE, 300);
    const r = onEntry(detached);
    expect(r.mode).toBe("sticky-bottom");
    expect(r.shouldScroll).toBe(true);
  });

  it("onJumpToBottom resets and triggers scroll", () => {
    const r = onJumpToBottom(onScroll(INITIAL_AUTOSCROLL_STATE, 300));
    expect(r.mode).toBe("sticky-bottom");
    expect(r.shouldScroll).toBe(true);
  });

  it("onMessageSent forces scroll regardless of mode", () => {
    const r = onMessageSent(onScroll(INITIAL_AUTOSCROLL_STATE, 500));
    expect(r.shouldScroll).toBe(true);
  });

  it("anchor row tracks and clears for prepend stability", () => {
    const s1 = setAnchorRow(INITIAL_AUTOSCROLL_STATE, "row-5");
    expect(s1.anchorRowId).toBe("row-5");
    const s2 = clearAnchorRow(s1);
    expect(s2.anchorRowId).toBeUndefined();
  });

  it("onScrollComplete clears pending flag", () => {
    const pending = onEntry(INITIAL_AUTOSCROLL_STATE);
    expect(pending.pending).toBe(true);
    expect(onScrollComplete(pending).pending).toBe(false);
  });
});
