import { describe, expect, it } from "vitest";

import {
  buildActivityLogModel,
  buildAssistantMessageModel,
  buildCompactionModel,
  buildFileLinkTooltip,
  buildTurnFooter,
  buildUserMessageModel,
  detectInlinePathLinks,
  formatDuration,
  formatTurnFooterLabel,
  parseFileUrl,
  segmentIntoTurns,
  shouldSuppressChrome,
  type TimelineRow,
  type TurnGroup,
} from "./index.js";

function makeRow(kind: TimelineRow["kind"], seqStart: number, payload: unknown = {}): TimelineRow {
  return { rowId: `r${seqStart}`, kind, seqStart, seqEnd: seqStart, source: "page", epochId: "e1", timestamp: seqStart * 1000, payload };
}

// ─── user/assistant row models ─────────────────────────────────────────────

describe("row treatment models", () => {
  it("user message model is right-aligned with rewind gating", () => {
    const m = buildUserMessageModel({ text: "Hello", timestamp: 1000, canRewind: true });
    expect(m.alignment).toBe("right");
    expect(m.showRewindMenu).toBe(true);
    expect(m.optimistic).toBe(false);
    expect(buildUserMessageModel({ text: "x", timestamp: 0, canRewind: false }).showRewindMenu).toBe(false);
  });

  it("assistant message collapses spacing for consecutive blocks in same group", () => {
    const m = buildAssistantMessageModel({ text: "block 2", blockGroupId: "g1", prevBlockGroupId: "g1", nextBlockGroupId: "g1" });
    expect(m.collapseTopSpacing).toBe(true);
    expect(m.collapseBottomSpacing).toBe(true);
    const first = buildAssistantMessageModel({ text: "block 1", blockGroupId: "g1", nextBlockGroupId: "g1" });
    expect(first.collapseTopSpacing).toBe(false);
    expect(first.collapseBottomSpacing).toBe(true);
  });

  it("compaction model labels loading / manual / auto / token-count variants", () => {
    expect(buildCompactionModel({ status: "loading" }).label).toBe("Compacting…");
    expect(buildCompactionModel({ status: "completed", trigger: "manual" }).label).toBe("Context manually compacted");
    expect(buildCompactionModel({ status: "completed", trigger: "auto" }).label).toBe("Context automatically compacted");
    expect(buildCompactionModel({ status: "completed", preTokens: 4000 }).label).toBe("Context compacted (4,000 tokens)");
  });

  it("activity log clickable only for artifact type", () => {
    expect(buildActivityLogModel({ activityType: "artifact", message: "m" }).clickable).toBe(true);
    expect(buildActivityLogModel({ activityType: "info", message: "m" }).clickable).toBe(false);
  });
});

// ─── turn grouping ────────────────────────────────────────────────────────

describe("turn grouping", () => {
  it("segments rows into turns starting at user_message boundaries", () => {
    const rows = [makeRow("user_message", 1), makeRow("assistant_message", 2), makeRow("tool_call", 3), makeRow("user_message", 4), makeRow("assistant_message", 5)];
    const turns = segmentIntoTurns(rows);
    expect(turns).toHaveLength(2);
    expect(turns[0]!.rows.map((r) => r.kind)).toEqual(["user_message", "assistant_message", "tool_call"]);
    expect(turns[1]!.rows.map((r) => r.kind)).toEqual(["user_message", "assistant_message"]);
  });

  it("rows before any user_message go into a synthetic first turn", () => {
    const rows = [makeRow("activity_log", 1), makeRow("user_message", 2)];
    const turns = segmentIntoTurns(rows);
    expect(turns[0]!.rows[0]!.kind).toBe("activity_log");
    expect(turns).toHaveLength(2);
  });

  it("buildTurnFooter returns running footer for last in-flight turn", () => {
    const turn: TurnGroup = { turnId: "t1", rows: [makeRow("user_message", 1), makeRow("assistant_message", 2)], status: "running", startedAt: 1000 };
    const footer = buildTurnFooter(turn, true, true);
    expect(footer?.status).toBe("running");
    expect(footer?.anchorRowId).toBe("r2");
  });

  it("buildTurnFooter returns completed footer with duration when completedAt is set", () => {
    const turn: TurnGroup = { turnId: "t1", rows: [makeRow("user_message", 1), makeRow("assistant_message", 2)], status: "completed", startedAt: 0, completedAt: 5000 };
    const footer = buildTurnFooter(turn, false, false);
    expect(footer?.status).toBe("completed");
    expect(footer?.durationMs).toBe(5000);
    expect(formatTurnFooterLabel(footer!)).toBe("Worked for 5s");
  });

  it("shouldSuppressChrome detects same-block-group consecutive assistant rows", () => {
    const prev = makeRow("assistant_message", 1, { blockGroupId: "g1" });
    const curr = makeRow("assistant_message", 2, { blockGroupId: "g1" });
    expect(shouldSuppressChrome(prev, curr)).toBe(true);
    expect(shouldSuppressChrome(prev, makeRow("assistant_message", 2, { blockGroupId: "g2" }))).toBe(false);
    expect(shouldSuppressChrome(undefined, curr)).toBe(false);
  });

  it("formatDuration handles ms / seconds / minutes", () => {
    expect(formatDuration(500)).toBe("500ms");
    expect(formatDuration(3500)).toBe("4s");
    expect(formatDuration(90000)).toBe("1m 30s");
    expect(formatDuration(120000)).toBe("2m");
  });
});

// ─── file-link detection ──────────────────────────────────────────────────

describe("file-link detection", () => {
  it("detects absolute paths in text", () => {
    const links = detectInlinePathLinks("See /home/user/repo/src/index.ts for details");
    expect(links.length).toBeGreaterThanOrEqual(1);
    expect(links[0]!.target.kind).toBe("file");
    expect((links[0]!.target as { path: string }).path).toBe("/home/user/repo/src/index.ts");
  });

  it("strips workspace prefix for relative label", () => {
    const links = detectInlinePathLinks("/repo/src/app.ts", "/repo");
    expect(links[0]!.workspaceRelative).toBe("src/app.ts");
  });

  it("parseFileUrl converts file:// href and external URLs", () => {
    expect(parseFileUrl("file:///home/user/file.ts")).toEqual({ kind: "file", path: "/home/user/file.ts" });
    expect(parseFileUrl("https://example.com")?.kind).toBe("external");
    expect(parseFileUrl("/local/path")).toBeNull();
  });

  it("buildFileLinkTooltip constructs relative path + sidePane flag", () => {
    const tip = buildFileLinkTooltip("/repo/src/a.ts", "/repo");
    expect(tip.workspaceRelative).toBe("src/a.ts");
    expect(tip.sidePane).toBe(true);
  });
});
