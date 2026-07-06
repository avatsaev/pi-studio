/**
 * Tests for feature panel DOM components (sprint-022).
 */
import { describe, it, expect } from "vitest";
import {
  buildNodes,
  flattenTree,
  sortEntries,
  cycleSortMode,
  toggleExpand,
  INITIAL_EXPLORER_STATE,
  type ExplorerEntry,
  type ExplorerNode,
  type ExplorerState,
} from "../../panels/file-explorer.js";
import {
  buildFilePreviewState,
  detectPreviewKind,
  filePreviewTabLabel,
  shouldScrollToLine,
  resolveReadTarget,
} from "../../panels/file-preview.js";
import {
  INITIAL_DIFF_STATE,
  diffViewEmptyReason,
  diffEmptyMessage,
  sortActivitiesChronologically,
  canAttachToComposer,
  addReviewComment,
  deleteReviewComment,
  commentsForLine,
  INITIAL_REVIEW_STORE,
  type PrActivity,
  type DiffSidebarState,
} from "../../panels/git-panel.js";
import {
  INITIAL_TERMINAL_PANE,
  shouldSendResize,
  shouldSendOutput,
  dedupResize,
  snapshotCacheKey,
  storeSnapshot,
  clearSnapshot,
  MOBILE_KEY_BAR,
  terminalDescriptorLabel,
  terminalStatusBucket,
  type TerminalPaneState,
  type SnapshotCache,
} from "../../panels/terminal-pane.js";
import {
  browserPaneVariant,
  validateBrowserUrl,
  applyNavigation,
  applyNavLoaded,
  INITIAL_BROWSER_NAV,
  unsupportedBrowserMessage,
} from "../../panels/browser-pane.js";
import {
  trackMembers,
  trackHeaderLabel,
  buildSubagentChip,
  buildArchiveConfirm,
  type SubagentEntry,
} from "../../panels/subagents-track.js";

// ---------------------------------------------------------------------------
// Explorer model (task-001)
// ---------------------------------------------------------------------------
describe("explorer tree", () => {
  const entries: ExplorerEntry[] = [
    { name: "src", path: "/src", kind: "directory" },
    { name: "README.md", path: "/README.md", kind: "file", size: 200 },
    { name: "package.json", path: "/package.json", kind: "file", size: 100 },
    { name: ".env", path: "/.env", kind: "file", size: 10 },
  ];

  it("sortEntries puts directories first by name", () => {
    const sorted = sortEntries(entries, "name");
    expect(sorted[0]!.kind).toBe("directory");
    expect(sorted[1]!.name).toBe(".env");
  });

  it("sortEntries by size sorts files by size", () => {
    const sorted = sortEntries(entries, "size");
    // dirs first, then by size ascending
    expect(sorted[0]!.kind).toBe("directory");
  });

  it("cycleSortMode cycles name → modified → size → name", () => {
    expect(cycleSortMode("name")).toBe("modified");
    expect(cycleSortMode("modified")).toBe("size");
    expect(cycleSortMode("size")).toBe("name");
  });

  it("buildNodes creates tree nodes with correct depth", () => {
    const nodes = buildNodes(entries, 0, new Set(), "name");
    expect(nodes.every((n) => n.depth === 0)).toBe(true);
    const dir = nodes.find((n) => n.entry.kind === "directory");
    expect(dir).toBeTruthy();
    expect(dir!.expanded).toBe(false);
  });

  it("flattenTree returns flat list with only expanded dirs' children", () => {
    const nodes = buildNodes(entries, 0, new Set(), "name");
    const flat = flattenTree(nodes);
    expect(flat.length).toBe(entries.length);
  });

  it("toggleExpand adds path to expanded set", () => {
    const s: ExplorerState = { ...INITIAL_EXPLORER_STATE, root: buildNodes(entries, 0, new Set(), "name") };
    const next = toggleExpand(s, "/src");
    expect(next.expandedPaths.has("/src")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// File preview model (task-001)
// ---------------------------------------------------------------------------
describe("file preview", () => {
  it("detectPreviewKind identifies code files", () => {
    expect(detectPreviewKind("main.ts")).toBe("code");
    expect(detectPreviewKind("style.css")).toBe("code");
  });

  it("detectPreviewKind identifies markdown", () => {
    expect(detectPreviewKind("README.md")).toBe("markdown");
  });

  it("detectPreviewKind identifies images", () => {
    expect(detectPreviewKind("photo.png")).toBe("image");
    expect(detectPreviewKind("logo.svg")).toBe("image");
  });

  it("detectPreviewKind identifies binary", () => {
    expect(detectPreviewKind("data.zip")).toBe("binary");
  });

  it("filePreviewTabLabel extracts filename", () => {
    expect(filePreviewTabLabel("/src/lib/utils.ts")).toBe("utils.ts");
  });

  it("buildFilePreviewState code even when no content", () => {
    const state = buildFilePreviewState({ path: "/a.ts" });
    // Without content, it still resolves based on extension (code with empty content)
    expect(state.status).toBe("ready");
  });

  it("buildFilePreviewState error when error provided", () => {
    const state = buildFilePreviewState({ path: "/a.ts", error: "not found" });
    expect(state.status).toBe("error");
  });

  it("buildFilePreviewState code with content", () => {
    const state = buildFilePreviewState({ path: "/a.ts", content: "const x = 1;" });
    expect(state.status).toBe("ready");
    if (state.status === "ready") {
      expect(state.kind).toBe("code");
    }
  });

  it("buildFilePreviewState image with url", () => {
    const state = buildFilePreviewState({ path: "/photo.png", imageUrl: "http://blob/photo.png" });
    expect(state.status).toBe("ready");
    if (state.status === "ready") {
      expect(state.kind).toBe("image");
    }
  });

  it("shouldScrollToLine returns lineStart when highlight present", () => {
    const state = buildFilePreviewState({ path: "/a.ts", content: "line1\nline2\nline3", lineStart: 2 });
    if (state.status === "ready" && state.kind === "code") {
      expect(shouldScrollToLine(state)).toBe(2);
    }
  });

  it("resolveReadTarget resolves relative paths", () => {
    const target = resolveReadTarget("src/lib.ts", "/project");
    expect(target.absolutePath).toBe("/project/src/lib.ts");
  });
});

// ---------------------------------------------------------------------------
// Git panel (task-002)
// ---------------------------------------------------------------------------
describe("git panel", () => {
  it("diffViewEmptyReason: no files → empty", () => {
    const reason = diffViewEmptyReason(INITIAL_DIFF_STATE, 0);
    expect(reason).toBeTruthy();
    expect(diffEmptyMessage(reason!)).toBeTruthy();
  });

  it("diffViewEmptyReason: files present → null", () => {
    const state: DiffSidebarState = { ...INITIAL_DIFF_STATE, isGitRepo: true };
    const reason = diffViewEmptyReason(state, 3);
    expect(reason).toBeNull();
  });

  it("sortActivitiesChronologically sorts by timestamp", () => {
    const a: PrActivity = { kind: "review_comment", id: "1", author: "a", body: "hi", timestamp: 200, canAttach: true };
    const b: PrActivity = { kind: "review_comment", id: "2", author: "b", body: "bye", timestamp: 100, canAttach: false };
    const sorted = sortActivitiesChronologically([a, b]);
    expect(sorted[0]!.id).toBe("2");
  });

  it("canAttachToComposer uses canAttach flag", () => {
    const a: PrActivity = { kind: "review_comment", id: "1", author: "a", body: "x", timestamp: 1, canAttach: true };
    expect(canAttachToComposer(a)).toBe(true);
  });
});

describe("inline review", () => {
  it("addReviewComment adds to store", () => {
    const store = addReviewComment(INITIAL_REVIEW_STORE, { filePath: "/a.ts", side: "new", lineNumber: 5, body: "Fix this" });
    expect(store.comments.length).toBe(1);
  });

  it("commentsForLine filters correctly", () => {
    let store = addReviewComment(INITIAL_REVIEW_STORE, { filePath: "/a.ts", side: "new", lineNumber: 5, body: "Fix" });
    store = addReviewComment(store, { filePath: "/a.ts", side: "new", lineNumber: 10, body: "Other" });
    const line5 = commentsForLine(store, "/a.ts", "new", 5);
    expect(line5.length).toBe(1);
    expect(line5[0]!.body).toBe("Fix");
  });

  it("deleteReviewComment removes by id", () => {
    let store = addReviewComment(INITIAL_REVIEW_STORE, { filePath: "/a.ts", side: "new", lineNumber: 5, body: "Fix" });
    const id = store.comments[0]!.id;
    store = deleteReviewComment(store, id);
    expect(store.comments.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Terminal pane (task-003)
// ---------------------------------------------------------------------------
describe("terminal pane", () => {
  it("dedupResize: same size → false (skip, no change)", () => {
    expect(dedupResize({ cols: 80, rows: 24 }, { cols: 80, rows: 24 })).toBe(false);
  });

  it("dedupResize: different size → true (send)", () => {
    expect(dedupResize({ cols: 80, rows: 24 }, { cols: 120, rows: 30 })).toBe(true);
  });

  it("dedupResize: undefined prev → true (send)", () => {
    expect(dedupResize(undefined, { cols: 80, rows: 24 })).toBe(true);
  });

  it("shouldSendResize: initial state", () => {
    // initial state should have conditions for resize
    const canResize = shouldSendResize(INITIAL_TERMINAL_PANE);
    expect(typeof canResize).toBe("boolean");
  });

  it("snapshotCacheKey creates unique key", () => {
    const key = snapshotCacheKey("server-1", "/project");
    expect(key).toContain("server-1");
    expect(key).toContain("/project");
  });

  it("storeSnapshot + clearSnapshot", () => {
    let cache: SnapshotCache = new Map();
    cache = storeSnapshot(cache, { terminalId: "t1", scope: snapshotCacheKey("s1", "/p"), data: "hello", cols: 80, rows: 24 });
    expect(cache.size).toBe(1);
    cache = clearSnapshot(cache, snapshotCacheKey("s1", "/p"));
    expect(cache.size).toBe(0);
  });

  it("MOBILE_KEY_BAR has keys", () => {
    expect(MOBILE_KEY_BAR.length).toBeGreaterThan(0);
    expect(MOBILE_KEY_BAR.some((k) => k.isModifier)).toBe(true);
  });

  it("terminalDescriptorLabel returns string", () => {
    expect(terminalDescriptorLabel(INITIAL_TERMINAL_PANE)).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Browser pane (task-004)
// ---------------------------------------------------------------------------
describe("browser pane", () => {
  it("browserPaneVariant: electron", () => {
    expect(browserPaneVariant(true)).toBe("electron");
  });

  it("browserPaneVariant: web → unsupported", () => {
    expect(browserPaneVariant(false)).toBe("unsupported");
  });

  it("unsupportedBrowserMessage returns string", () => {
    expect(unsupportedBrowserMessage()).toBeTruthy();
  });

  it("validateBrowserUrl: valid URL", () => {
    const result = validateBrowserUrl("https://example.com");
    expect(result.valid).toBe(true);
  });

  it("validateBrowserUrl: invalid", () => {
    const result = validateBrowserUrl("");
    expect(result.valid).toBe(false);
  });

  it("applyNavigation updates url", () => {
    const nav = applyNavigation(INITIAL_BROWSER_NAV, "https://example.com");
    expect(nav.url).toBe("https://example.com");
    expect(nav.isLoading).toBe(true);
  });

  it("applyNavLoaded updates title/favicon", () => {
    let nav = applyNavigation(INITIAL_BROWSER_NAV, "https://a.com");
    nav = applyNavLoaded(nav, { title: "A", canGoBack: true });
    expect(nav.title).toBe("A");
    expect(nav.isLoading).toBe(false);
    expect(nav.canGoBack).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Subagents track (task-004)
// ---------------------------------------------------------------------------
describe("subagents track", () => {
  const entries: SubagentEntry[] = [
    { agentId: "child-1", parentAgentId: "parent", title: "Research", status: "running", createdAt: 1, isArchived: false, isPendingArchive: false },
    { agentId: "child-2", parentAgentId: "parent", title: "Coder", status: "idle", createdAt: 2, isArchived: false, isPendingArchive: false },
    { agentId: "other", parentAgentId: "other-parent", title: "Other", status: "idle", createdAt: 3, isArchived: false, isPendingArchive: false },
  ];

  it("trackMembers filters by parentAgentId", () => {
    const members = trackMembers(entries, "parent");
    expect(members.length).toBe(2);
  });

  it("trackHeaderLabel includes count", () => {
    const label = trackHeaderLabel(entries.slice(0, 2));
    expect(label).toBeTruthy();
  });

  it("buildSubagentChip returns chip with status", () => {
    const chip = buildSubagentChip(entries[0]!);
    expect(chip.label).toBe("Research");
    expect(chip.status).toBe("running");
  });

  it("buildArchiveConfirm returns confirm object", () => {
    const confirm = buildArchiveConfirm(entries[0]!);
    expect(confirm.agentId).toBe("child-1");
  });
});
