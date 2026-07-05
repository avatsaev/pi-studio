import { describe, expect, it } from "vitest";

import {
  activeTabForPane,
  closeTabInLayout,
  createMemoryLayoutStorage,
  createWorkspaceTab,
  defaultWorkspaceLayout,
  dragPreview,
  findPane,
  focusPane,
  listPanes,
  mountedHiddenStyle,
  mountedTabState,
  moveTabBetweenPanes,
  nextMountedTabLru,
  normalizeSizes,
  openChildTab,
  openTabInFocusedPane,
  reorderTabInPane,
  resizeGroup,
  resolvePaneDropPosition,
  restoreFocus,
  retargetTabInLayout,
  splitEmptyToSide,
  splitTabToSide,
  supportsPaneSplits,
  unfocusWithToken,
  WorkspaceLayoutStore,
  workspacePersistenceKey,
  type SplitGroup,
} from "./index.js";

describe("pane layout operations", () => {
  it("creates a default single pane and derives active tab by preferred > pane focused > first", () => {
    const layout = defaultWorkspaceLayout(["a", "b"]);
    const pane = findPane(layout.root, "main")!;
    expect(activeTabForPane(pane, { preferredTabId: "b" })).toBe("b");
    expect(activeTabForPane({ ...pane, focusedTabId: "b" })).toBe("b");
    expect(activeTabForPane({ ...pane, focusedTabId: undefined })).toBe("a");
  });

  it("opens focused/background/child tabs and records parent relation", () => {
    const a = createWorkspaceTab({ kind: "agent", agentId: "a" });
    const b = createWorkspaceTab({ kind: "terminal", terminalId: "b" });
    const c = createWorkspaceTab({ kind: "browser", browserId: "c" });
    let layout = openTabInFocusedPane(defaultWorkspaceLayout(), a, "focused");
    layout = openTabInFocusedPane(layout, b, "background");
    layout = openChildTab(layout, a.tabId, c);
    const pane = findPane(layout.root, "main")!;
    expect(pane.tabIds).toEqual(["agent_a", "terminal_b", "browser_c"]);
    expect(pane.focusedTabId).toBe("browser_c");
    expect(layout.parentTabId.browser_c).toBe("agent_a");
  });

  it("close removes tabs, picks previous focus, and collapses empty panes", () => {
    let layout = defaultWorkspaceLayout(["a", "b"]);
    layout = splitTabToSide(layout, "main", "b", "right", "right").layout;
    expect(listPanes(layout.root).map((p) => p.id).sort()).toEqual(["main", "right"]);
    layout = closeTabInLayout(layout, "b");
    expect(listPanes(layout.root).map((p) => p.id)).toEqual(["main"]);
  });

  it("reorders and retargets tab ids across layout and parent map", () => {
    let layout = defaultWorkspaceLayout(["draft", "x", "y"]);
    layout = { ...layout, parentTabId: { draft: "parent" } };
    layout = reorderTabInPane(layout, "main", 0, 2);
    expect(findPane(layout.root, "main")?.tabIds).toEqual(["x", "y", "draft"]);
    layout = retargetTabInLayout(layout, "draft", { kind: "agent", agentId: "a" });
    expect(findPane(layout.root, "main")?.tabIds).toEqual(["x", "y", "agent_a"]);
    expect(layout.parentTabId.agent_a).toBe("parent");
  });

  it("splits tabs to side and refuses split at max depth", () => {
    let layout = defaultWorkspaceLayout(["a", "b"]);
    const first = splitTabToSide(layout, "main", "b", "right", "p2");
    expect(first.split).toBe(true);
    layout = first.layout;
    expect((layout.root as SplitGroup).direction).toBe("row");
    expect(layout.focusedPaneId).toBe("p2");
    for (let i = 3; i <= 5; i++) layout = splitTabToSide(layout, `p${i - 1}`, "b", "right", `p${i}`).layout;
    expect(splitTabToSide(layout, "p5", "b", "right", "p6").split).toBe(false);
  });

  it("split empty seeds a draft tab", () => {
    const result = splitEmptyToSide(defaultWorkspaceLayout([]), "main", "bottom", "bottom", "draft-1", 1);
    expect(result.split).toBe(true);
    expect(result.tab.tabId).toBe("draft-1");
    expect(findPane(result.layout.root, "bottom")?.tabIds).toEqual(["draft-1"]);
  });

  it("moving tabs between panes collapses empty source", () => {
    let layout = splitTabToSide(defaultWorkspaceLayout(["a", "b"]), "main", "b", "right", "right").layout;
    layout = moveTabBetweenPanes(layout, "right", "main", "b", 0);
    expect(listPanes(layout.root).map((p) => p.id)).toEqual(["main"]);
    expect(findPane(layout.root, "main")?.tabIds).toEqual(["b", "a"]);
  });

  it("focus token restores transient unfocus", () => {
    let layout = focusPane(splitTabToSide(defaultWorkspaceLayout(["a", "b"]), "main", "b", "right", "right").layout, "main");
    layout = unfocusWithToken(layout, "modal");
    expect(layout.focusRestoreToken).toBe("modal");
    expect(restoreFocus(layout, "wrong").focusRestoreToken).toBe("modal");
    expect(restoreFocus(layout, "modal").focusRestoreToken).toBeUndefined();
  });

  it("resize proportions are clamped and persisted", () => {
    let layout = splitTabToSide(defaultWorkspaceLayout(["a", "b"]), "main", "b", "right", "right").layout;
    const groupId = (layout.root as SplitGroup).id;
    layout = resizeGroup(layout, groupId, [0.01, 0.99]);
    const sizes = (layout.root as SplitGroup).sizes;
    expect(sizes[0]).toBeGreaterThan(0.13);
    expect(normalizeSizes([1, 1, 1], 3)).toHaveLength(3);

    const storage = createMemoryLayoutStorage();
    const store = new WorkspaceLayoutStore(storage);
    store.save("server", "workspace", layout);
    expect(storage.dump()[workspacePersistenceKey("server", "workspace")]).toContain(groupId);
    expect(store.load("server", "workspace").focusedPaneId).toBe(layout.focusedPaneId);
  });
});

describe("mounted-tab keepalive", () => {
  it("keeps at most 3 recent tabs warm with active first", () => {
    let lru: string[] = [];
    for (const id of ["a", "b", "c", "d"]) lru = nextMountedTabLru(lru, id);
    expect(lru).toEqual(["d", "c", "b"]);
    expect(mountedTabState("d", "d", lru)).toBe("active");
    expect(mountedTabState("c", "d", lru)).toBe("mounted-hidden");
    expect(mountedTabState("a", "d", lru)).toBe("unmounted");
    expect(mountedHiddenStyle("mounted-hidden")).toMatchObject({ pointerEvents: "none", hidden: true });
  });
});

describe("web DnD split helpers", () => {
  it("supports splits only on non-compact web", () => {
    expect(supportsPaneSplits("web", false)).toBe(true);
    expect(supportsPaneSplits("web", true)).toBe(false);
    expect(supportsPaneSplits("desktop", false)).toBe(false);
  });

  it("resolves edge drop splitting and center reorder", () => {
    const rect = { x: 0, y: 0, width: 100, height: 100 };
    expect(resolvePaneDropPosition(rect, { x: 2, y: 50 }, 2)).toEqual({ kind: "split", side: "left" });
    expect(resolvePaneDropPosition(rect, { x: 98, y: 50 }, 2)).toEqual({ kind: "split", side: "right" });
    expect(resolvePaneDropPosition(rect, { x: 50, y: 2 }, 2)).toEqual({ kind: "split", side: "top" });
    expect(resolvePaneDropPosition(rect, { x: 50, y: 98 }, 2)).toEqual({ kind: "split", side: "bottom" });
    expect(resolvePaneDropPosition(rect, { x: 50, y: 50 }, 2)).toEqual({ kind: "reorder", index: 1 });
    expect(dragPreview("main", { kind: "move" }, "Agent")).toEqual({ paneId: "main", position: { kind: "move" }, overlayLabel: "Agent" });
  });
});
