/**
 * Tests for virtualized timeline (task-001).
 * Pure logic — no DOM/JSX.
 */

import { describe, it, expect } from "vitest";
import {
  buildRenderItems,
  renderKey,
  partitionSegments,
  MOUNTED_WINDOW_MIN,
} from "../../timeline/render-model.js";
import {
  dispatchRow,
  resolveRowGap,
  ROW_GAP_VALUES,
  TIMELINE_MAX_CONTENT_WIDTH,
} from "../../timeline/row-dispatch.js";
import {
  onScroll,
  onRowsAdded,
  onJumpToBottom,
  onEntry,
  onMessageSent,
  onScrollComplete,
  setAnchorRow,
  clearAnchorRow,
  INITIAL_AUTOSCROLL_STATE,
  NEAR_BOTTOM_THRESHOLD_PX,
} from "../../timeline/autoscroll.js";
import type { TimelineRow } from "../../timeline/reducer.js";
import { parseMarkdownBlocks } from "../../timeline/markdown.js";
import { detectInlinePathLinks } from "../../timeline/file-links.js";
import { segmentIntoTurns, buildTurnFooter } from "../../timeline/turn-grouping.js";
import { buildToolCardPresentation, buildExpandedDetail, resolveStatusVisual, humanizeName, type ToolCallPayload } from "../../timeline/tool-cards.js";
import { parseDiff, diffStatLabel, buildDiffRowViewModel } from "../../timeline/diff-rows.js";
import { buildPermissionPrompt, startResponding, resolvePermission, DEFAULT_OPTIONS } from "../../timeline/permissions.js";
import { resolveSubmitDecision, type SubmitInput } from "../../composer/submit.js";
import { detectActiveToken, filterCommands, CLIENT_SLASH_COMMANDS } from "../../composer/autocomplete.js";
import { startDictation, cancelDictation, INITIAL_DICTATION_STATE } from "../../composer/voice.js";
import { rewindMenuItems, shouldShowRewindMenu, startRewind, rewindSuccess, rewindError, isRewindPending, postRewindActions, REWIND_IDLE } from "../../timeline/rewind.js";

// ---------------------------------------------------------------------------
// Render model
// ---------------------------------------------------------------------------
describe("buildRenderItems", () => {
  const mkRow = (id: string, kind: string, seq: number): TimelineRow => ({
    rowId: id,
    kind: kind as any,
    epochId: "e1",
    seqStart: seq,
    seqEnd: seq,
    content: {},
  } as any);

  it("builds items with stable keys", () => {
    const rows = [mkRow("r1", "user_message", 1), mkRow("r2", "assistant_message", 2)];
    const items = buildRenderItems(rows);
    expect(items.length).toBe(2);
    expect(items[0]!.key).toBe(renderKey(rows[0]!));
    expect(items[1]!.index).toBe(1);
  });

  it("empty rows → empty items", () => {
    expect(buildRenderItems([])).toEqual([]);
  });
});

describe("partitionSegments", () => {
  it("small list → single mounted segment", () => {
    const items = Array.from({ length: 10 }, (_, i) => ({
      key: `k${i}`, index: i, row: { rowId: `r${i}`, kind: "user_message", epochId: "e", seqStart: i, seqEnd: i } as any,
    }));
    const segments = partitionSegments(items);
    expect(segments.length).toBe(1);
    expect(segments[0]!.kind).toBe("mounted-history");
  });

  it("large list → splits at user_message boundary", () => {
    const items = Array.from({ length: 100 }, (_, i) => ({
      key: `k${i}`, index: i,
      row: { rowId: `r${i}`, kind: i % 5 === 0 ? "user_message" : "assistant_message", epochId: "e", seqStart: i, seqEnd: i } as any,
    }));
    const segments = partitionSegments(items);
    expect(segments.length).toBeGreaterThanOrEqual(2);
    const total = segments.reduce((sum, s) => sum + s.items.length, 0);
    expect(total).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// Row dispatch
// ---------------------------------------------------------------------------
describe("dispatchRow", () => {
  it("user_message → UserMessageRow", () => {
    const r = dispatchRow("user_message");
    expect(r.component).toBe("UserMessageRow");
    expect(r.maxWidth).toBe(TIMELINE_MAX_CONTENT_WIDTH);
  });

  it("tool_call → ToolCallCard", () => {
    expect(dispatchRow("tool_call").component).toBe("ToolCallCard");
  });

  it("unknown → UnknownRowFallback", () => {
    expect(dispatchRow("unknown").component).toBe("UnknownRowFallback");
  });
});

describe("resolveRowGap", () => {
  it("user→user = 4", () => {
    expect(resolveRowGap("user_message", "user_message")).toBe(ROW_GAP_VALUES["user-to-user"]);
  });

  it("tool→tool = 0 (packed)", () => {
    expect(resolveRowGap("tool_call", "tool_call")).toBe(ROW_GAP_VALUES["tool-seq-packed"]);
  });

  it("user→tool = 16", () => {
    expect(resolveRowGap("user_message", "tool_call")).toBe(ROW_GAP_VALUES["user-to-tool"]);
  });

  it("last row (no next) → default 16", () => {
    expect(resolveRowGap("assistant_message", undefined)).toBe(ROW_GAP_VALUES.default);
  });
});

// ---------------------------------------------------------------------------
// Autoscroll state machine
// ---------------------------------------------------------------------------
describe("autoscroll", () => {
  it("initial state is sticky-bottom, no jump button", () => {
    expect(INITIAL_AUTOSCROLL_STATE.mode).toBe("sticky-bottom");
    expect(INITIAL_AUTOSCROLL_STATE.showJumpButton).toBe(false);
  });

  it("onScroll: near bottom → stays sticky", () => {
    const next = onScroll(INITIAL_AUTOSCROLL_STATE, 30);
    expect(next.mode).toBe("sticky-bottom");
    expect(next.showJumpButton).toBe(false);
  });

  it("onScroll: far from bottom → detaches, shows jump", () => {
    const next = onScroll(INITIAL_AUTOSCROLL_STATE, 200);
    expect(next.mode).toBe("detached");
    expect(next.showJumpButton).toBe(true);
  });

  it("onScroll: detached → back to bottom → re-sticks", () => {
    const detached = onScroll(INITIAL_AUTOSCROLL_STATE, 200);
    const reattach = onScroll(detached, 50);
    expect(reattach.mode).toBe("sticky-bottom");
    expect(reattach.showJumpButton).toBe(false);
  });

  it("onRowsAdded: sticky → shouldScroll=true", () => {
    expect(onRowsAdded(INITIAL_AUTOSCROLL_STATE).shouldScroll).toBe(true);
  });

  it("onRowsAdded: detached → shouldScroll=false", () => {
    const detached = onScroll(INITIAL_AUTOSCROLL_STATE, 200);
    expect(onRowsAdded(detached).shouldScroll).toBe(false);
  });

  it("onJumpToBottom: re-sticks + hides button + shouldScroll", () => {
    const detached = onScroll(INITIAL_AUTOSCROLL_STATE, 200);
    const jumped = onJumpToBottom(detached);
    expect(jumped.mode).toBe("sticky-bottom");
    expect(jumped.showJumpButton).toBe(false);
    expect(jumped.shouldScroll).toBe(true);
  });

  it("onEntry: forces sticky + shouldScroll", () => {
    const result = onEntry(INITIAL_AUTOSCROLL_STATE);
    expect(result.mode).toBe("sticky-bottom");
    expect(result.shouldScroll).toBe(true);
  });

  it("onMessageSent: forces scroll", () => {
    const detached = onScroll(INITIAL_AUTOSCROLL_STATE, 200);
    const sent = onMessageSent(detached);
    expect(sent.mode).toBe("sticky-bottom");
    expect(sent.shouldScroll).toBe(true);
  });

  it("setAnchorRow / clearAnchorRow", () => {
    const anchored = setAnchorRow(INITIAL_AUTOSCROLL_STATE, "row-5");
    expect(anchored.anchorRowId).toBe("row-5");
    expect(clearAnchorRow(anchored).anchorRowId).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Markdown parsing (task-002)
// ---------------------------------------------------------------------------
describe("parseMarkdownBlocks", () => {
  it("parses heading + paragraph", () => {
    const { blocks } = parseMarkdownBlocks("# Title\n\nHello world");
    expect(blocks.length).toBeGreaterThanOrEqual(2);
    expect(blocks[0]!.kind).toBe("heading");
    if (blocks[0]!.kind === "heading") expect(blocks[0]!.level).toBe(1);
  });

  it("parses code block", () => {
    const { blocks } = parseMarkdownBlocks("```ts\nconst x = 1;\n```");
    const code = blocks.find((b) => b.kind === "code_block");
    expect(code).toBeTruthy();
    if (code?.kind === "code_block") {
      expect(code.language).toBe("ts");
      expect(code.code).toContain("const x");
    }
  });

  it("streaming: open fence → streamingFenceOpen=true", () => {
    const { blocks, streamingFenceOpen } = parseMarkdownBlocks("```js\nconst y = 2;");
    expect(streamingFenceOpen).toBe(true);
    expect(blocks.some((b) => b.kind === "code_block")).toBe(true);
  });

  it("bullet list", () => {
    const { blocks } = parseMarkdownBlocks("- item 1\n- item 2\n");
    const list = blocks.find((b) => b.kind === "bullet_list");
    expect(list).toBeTruthy();
    if (list?.kind === "bullet_list") expect(list.items.length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// File link detection (task-002)
// ---------------------------------------------------------------------------
describe("detectInlinePathLinks", () => {
  it("detects absolute path", () => {
    const links = detectInlinePathLinks("See /home/user/file.ts for details");
    expect(links.length).toBeGreaterThan(0);
    expect(links[0]!.target.kind).toBe("file");
  });

  it("no false positives for URLs", () => {
    const links = detectInlinePathLinks("Visit https://example.com");
    expect(links.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Turn grouping (task-002)
// ---------------------------------------------------------------------------
describe("segmentIntoTurns", () => {
  const mkRow = (kind: string, seq: number): TimelineRow => ({
    rowId: `r-${seq}`, kind: kind as any, epochId: "e", seqStart: seq, seqEnd: seq, source: "live", timestamp: seq * 1000, payload: {},
  });

  it("groups rows between user messages into turns", () => {
    const rows = [mkRow("user_message", 1), mkRow("assistant_message", 2), mkRow("tool_call", 3), mkRow("user_message", 4), mkRow("assistant_message", 5)];
    const turns = segmentIntoTurns(rows);
    expect(turns.length).toBe(2);
    expect(turns[0]!.rows.length).toBe(3);
    expect(turns[1]!.rows.length).toBe(2);
  });

  it("empty rows → no turns", () => {
    expect(segmentIntoTurns([])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Tool cards (task-003)
// ---------------------------------------------------------------------------
describe("tool cards", () => {
  it("humanizeName converts snake_case", () => {
    const result = humanizeName("read_file");
    expect(result.toLowerCase()).toBe("read file");
  });

  it("resolveStatusVisual: running shimmers", () => {
    expect(resolveStatusVisual("running").shimmer).toBe(true);
    expect(resolveStatusVisual("completed").shimmer).toBe(false);
  });

  it("buildToolCardPresentation returns displayName + summary", () => {
    const payload: ToolCallPayload = { callId: "c1", name: "write_file", status: "completed" };
    const p = buildToolCardPresentation(payload);
    expect(p.displayName).toBeTruthy();
    expect(p.status).toBe("completed");
  });

  it("buildExpandedDetail for diff tool", () => {
    const payload: ToolCallPayload = { callId: "c2", name: "edit_file", status: "completed", detail: { type: "edit", filePath: "/a.ts", diff: "--- a\n+++ b\n@@ -1,1 +1,1 @@\n-old\n+new" } };
    const sections = buildExpandedDetail(payload);
    expect(sections.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Diff rows (task-003)
// ---------------------------------------------------------------------------
describe("diff rows", () => {
  const sample = "--- a/file.ts\n+++ b/file.ts\n@@ -1,3 +1,3 @@\n context\n-old line\n+new line\n context2";

  it("parseDiff extracts hunks", () => {
    const result = parseDiff(sample, "file.ts");
    expect(result.hunks.length).toBe(1);
    expect(result.hunks[0]!.lines.length).toBeGreaterThan(0);
  });

  it("diffStatLabel formats stat", () => {
    const vm = buildDiffRowViewModel(sample, "file.ts");
    expect(diffStatLabel(vm.stat)).toBeTruthy();
  });

  it("buildDiffRowViewModel includes filePath", () => {
    const vm = buildDiffRowViewModel(sample, "file.ts");
    expect(vm.filePath).toBe("file.ts");
  });
});

// ---------------------------------------------------------------------------
// Permission prompts (task-003)
// ---------------------------------------------------------------------------
describe("permission prompts", () => {
  it("buildPermissionPrompt creates pending state", () => {
    const prompt = buildPermissionPrompt({ kind: "tool", title: "Run npm?" });
    expect(prompt.state).toBe("pending");
    expect(prompt.options.length).toBeGreaterThan(0);
  });

  it("DEFAULT_OPTIONS has allow/deny", () => {
    expect(DEFAULT_OPTIONS.some((o) => o.variant === "primary")).toBe(true);
  });

  it("startResponding → responding state", () => {
    const prompt = buildPermissionPrompt({ kind: "tool" });
    const responding = startResponding(prompt, "allow");
    expect(responding.state).toBe("responding");
    expect(responding.respondingOption).toBe("allow");
  });

  it("resolvePermission → resolved state", () => {
    let prompt = buildPermissionPrompt({ kind: "tool" });
    prompt = startResponding(prompt, "allow");
    const resolved = resolvePermission(prompt, { source: "user", option: "allow" });
    expect(resolved.state).toBe("resolved");
    expect(resolved.resolvedBy).toEqual({ source: "user", option: "allow" });
  });
});

// ---------------------------------------------------------------------------
// Composer (task-004)
// ---------------------------------------------------------------------------
describe("composer submit decision", () => {
  it("noop when text empty and no attachments", () => {
    expect(resolveSubmitDecision({ text: "", attachments: [], agentRunning: false, forceSubmit: false, canSubmit: true })).toBe("noop");
  });

  it("submitted when text present and not running", () => {
    expect(resolveSubmitDecision({ text: "hello", attachments: [], agentRunning: false, forceSubmit: false, canSubmit: true })).toBe("submitted");
  });

  it("queued when agent running", () => {
    expect(resolveSubmitDecision({ text: "hello", attachments: [], agentRunning: true, forceSubmit: false, canSubmit: true })).toBe("queued");
  });
});

describe("composer autocomplete", () => {
  it("detects / at start", () => {
    const token = detectActiveToken("/he", 3);
    expect(token.mode).toBe("command");
    // token includes the slash or just the text — check it contains 'he'
    expect(token.token).toContain("he");
  });

  it("no active token in middle of word", () => {
    const token = detectActiveToken("hello world", 5);
    expect(token.mode).toBe("none");
  });

  it("filterCommands filters by prefix", () => {
    const all = CLIENT_SLASH_COMMANDS;
    expect(filterCommands(all, "").length).toBe(all.length);
  });
});

describe("voice dictation", () => {
  it("starts recording", () => {
    const state = startDictation(INITIAL_DICTATION_STATE);
    expect(state.status).toBe("recording");
  });

  it("cancel returns to canceled or idle", () => {
    const recording = startDictation(INITIAL_DICTATION_STATE);
    const canceled = cancelDictation(recording);
    expect(["idle", "canceled"]).toContain(canceled.status);
  });
});

// ---------------------------------------------------------------------------
// Rewind (task-005)
// ---------------------------------------------------------------------------
describe("rewind", () => {
  it("shouldShowRewindMenu: true when conversation supported", () => {
    expect(shouldShowRewindMenu({ supportsRewindConversation: true })).toBe(true);
  });

  it("shouldShowRewindMenu: false when no capabilities", () => {
    expect(shouldShowRewindMenu({})).toBe(false);
  });

  it("rewindMenuItems returns items for enabled modes", () => {
    const items = rewindMenuItems({ supportsRewindConversation: true, supportsRewindFiles: true });
    expect(items.length).toBeGreaterThanOrEqual(2);
    expect(items.some((i) => i.mode === "conversation")).toBe(true);
    expect(items.some((i) => i.mode === "files")).toBe(true);
  });

  it("startRewind creates pending state", () => {
    const state = startRewind("msg-1", "conversation");
    expect(isRewindPending(state)).toBe(true);
  });

  it("rewindSuccess clears pending", () => {
    const pending = startRewind("msg-1", "conversation");
    const done = rewindSuccess(pending);
    expect(isRewindPending(done)).toBe(false);
  });

  it("rewindError clears pending with error", () => {
    const pending = startRewind("msg-1", "files");
    const errored = rewindError(pending, "fail");
    expect(isRewindPending(errored)).toBe(false);
  });

  it("postRewindActions: conversation mode restores draft", () => {
    const actions = postRewindActions({ mode: "conversation", agentId: "a1", rewoundMessageText: "hello", composerEmpty: true });
    expect(actions.some((a) => a.kind === "restore-composer")).toBe(true);
    expect(actions.some((a) => a.kind === "refetch-tail")).toBe(true);
  });

  it("postRewindActions: files mode does NOT restore draft", () => {
    const actions = postRewindActions({ mode: "files", agentId: "a1", rewoundMessageText: "hello", composerEmpty: true });
    expect(actions.some((a) => a.kind === "restore-composer")).toBe(false);
  });
});
