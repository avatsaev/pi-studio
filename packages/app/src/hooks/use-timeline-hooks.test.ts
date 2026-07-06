/**
 * Timeline subscription hook tests — sprint-024 / task-003
 *
 * Tests the autoscroll state machine and sync planner integration.
 * The React hook itself is tested via store-level interactions.
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  INITIAL_AUTOSCROLL_STATE,
  onRowsAdded,
  onScroll,
  onJumpToBottom,
  onEntry,
  onScrollComplete,
  NEAR_BOTTOM_THRESHOLD_PX,
} from "../timeline/autoscroll.js";
import {
  planInitialSync,
  advanceSyncProgress,
  DEFAULT_PAGE_LIMIT,
} from "../timeline/sync-planner.js";
import { useSessionStore } from "../store/session-store.js";
import { buildRenderItems } from "../timeline/render-model.js";
import type { TimelineRow } from "../timeline/reducer.js";

function makeRow(seq: number, kind: TimelineRow["kind"] = "user_message"): TimelineRow {
  return {
    rowId: `r${seq}`,
    kind,
    seqStart: seq,
    seqEnd: seq,
    source: "live",
    epochId: "e1",
    timestamp: Date.now(),
    payload: {},
  };
}

// ─── Autoscroll state machine ─────────────────────────────────────────────────

describe("autoscroll state machine", () => {
  it("starts in sticky-bottom mode", () => {
    expect(INITIAL_AUTOSCROLL_STATE.mode).toBe("sticky-bottom");
    expect(INITIAL_AUTOSCROLL_STATE.showJumpButton).toBe(false);
  });

  it("onRowsAdded → shouldScroll=true when sticky", () => {
    const result = onRowsAdded(INITIAL_AUTOSCROLL_STATE);
    expect(result.shouldScroll).toBe(true);
  });

  it("onRowsAdded → shouldScroll=false when detached", () => {
    const detached = { ...INITIAL_AUTOSCROLL_STATE, mode: "detached" as const, showJumpButton: true };
    const result = onRowsAdded(detached);
    expect(result.shouldScroll).toBe(false);
  });

  it("onScroll: scrolling up detaches and shows jump button", () => {
    const result = onScroll(INITIAL_AUTOSCROLL_STATE, NEAR_BOTTOM_THRESHOLD_PX + 100);
    expect(result.mode).toBe("detached");
    expect(result.showJumpButton).toBe(true);
  });

  it("onScroll: scrolling back near bottom re-attaches", () => {
    const detached = { ...INITIAL_AUTOSCROLL_STATE, mode: "detached" as const, showJumpButton: true };
    const result = onScroll(detached, 10); // near bottom
    expect(result.mode).toBe("sticky-bottom");
    expect(result.showJumpButton).toBe(false);
  });

  it("onJumpToBottom: returns to sticky + shouldScroll", () => {
    const detached = { ...INITIAL_AUTOSCROLL_STATE, mode: "detached" as const, showJumpButton: true };
    const result = onJumpToBottom(detached);
    expect(result.mode).toBe("sticky-bottom");
    expect(result.shouldScroll).toBe(true);
    expect(result.showJumpButton).toBe(false);
  });

  it("onScrollComplete: clears pending", () => {
    const pending = { ...INITIAL_AUTOSCROLL_STATE, pending: true };
    const result = onScrollComplete(pending);
    expect(result.pending).toBe(false);
  });
});

// ─── Sync planner ─────────────────────────────────────────────────────────────

describe("sync planner", () => {
  it("planInitialSync with no cursor → fresh-tail fetch direction=before", () => {
    const plan = planInitialSync("a1", undefined);
    expect(plan.kind).toBe("fresh-tail");
    expect(plan.fetchRequest.direction).toBe("before");
    expect(plan.fetchRequest.cursor).toBeUndefined();
    expect(plan.fetchRequest.limit).toBe(DEFAULT_PAGE_LIMIT);
  });

  it("planInitialSync with cursor → resume-from-cursor fetch direction=after", () => {
    const plan = planInitialSync("a1", "cursor-abc");
    expect(plan.kind).toBe("resume-from-cursor");
    expect(plan.fetchRequest.direction).toBe("after");
    expect(plan.fetchRequest.cursor).toBe("cursor-abc");
  });

  it("advanceSyncProgress: done=true when hasNewer=false", () => {
    const result = advanceSyncProgress("a1", "cursor", false);
    expect(result.done).toBe(true);
  });

  it("advanceSyncProgress: done=false with nextRequest when hasNewer=true", () => {
    const result = advanceSyncProgress("a1", "cursor-xyz", true);
    expect(result.done).toBe(false);
    if (!result.done) {
      expect(result.nextRequest.cursor).toBe("cursor-xyz");
      expect(result.nextRequest.direction).toBe("after");
    }
  });
});

// ─── Session store → render items ─────────────────────────────────────────────

describe("session store timeline → render items", () => {
  beforeEach(() => {
    useSessionStore.setState({ agents: {}, workspaces: {}, servers: {}, activeServerId: null });
  });

  it("buildRenderItems produces one item per row", () => {
    const rows = [makeRow(1, "user_message"), makeRow(2, "assistant_message"), makeRow(3, "tool_call")];
    const items = buildRenderItems(rows);
    expect(items).toHaveLength(3);
    expect(items[0]?.row.kind).toBe("user_message");
    expect(items[1]?.row.kind).toBe("assistant_message");
    expect(items[2]?.row.kind).toBe("tool_call");
  });

  it("session store applyStreamEvent adds a row", () => {
    useSessionStore.getState().upsertAgent({ agentId: "a1" });
    const event = { type: "assistant_message", seq: 5, rowId: "r5", epochId: "e1" } as never;
    useSessionStore.getState().applyStreamEvent("a1", event);
    const timeline = useSessionStore.getState().agents["a1"]?.timeline!;
    expect(timeline.rows).toHaveLength(1);
    const items = buildRenderItems(timeline.rows);
    expect(items[0]?.row.kind).toBe("assistant_message");
    expect(items[0]?.key).toContain("e1");
  });

  it("pagination merge produces correct items after page+live mix", () => {
    useSessionStore.getState().upsertAgent({ agentId: "a1" });
    // Add live row at seq 10
    useSessionStore.getState().applyStreamEvent("a1", {
      type: "user_message", seq: 10, rowId: "live10", epochId: "e1",
    } as never);
    // Merge page covering 1-5
    useSessionStore.getState().mergePage("a1", {
      rows: [makeRow(1), makeRow(2), makeRow(3)],
      seqStart: 1,
      seqEnd: 3,
      hasNewer: true,
      startCursor: "cursor-start",
      endCursor: "cursor-end",
    });
    const timeline = useSessionStore.getState().agents["a1"]?.timeline!;
    // Should have page rows + live row, sorted by seqStart
    expect(timeline.rows).toHaveLength(4);
    expect(timeline.rows[0]?.seqStart).toBe(1);
    expect(timeline.rows[3]?.seqStart).toBe(10);
  });
});
