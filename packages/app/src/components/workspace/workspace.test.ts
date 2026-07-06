/**
 * Tests for tab strip + pinned targets (sprint-020/task-002).
 * Pure logic — no DOM/JSX.
 */

import { describe, it, expect } from "vitest";
import {
  distributeTabWidths,
  tabContextMenu,
  trailingTabActions,
  TAB_ICON_MIN_WIDTH,
  TAB_MAX_WIDTH,
} from "../../workspace/tab-strip.js";
import {
  quickLaunchButtons,
  togglePinnedTarget,
  pinnedTargetKey,
  migratePinnedTargets,
  DEFAULT_PINNED_TARGETS,
  PinnedTargetsStore,
  type PinnedTabTarget,
} from "../../workspace/pinned-targets.js";
import { isMiddleClickClose } from "../../workspace/composition.js";
import {
  resolvePaneDropPosition,
  supportsPaneSplits,
  type DropRect,
} from "../../workspace/dnd.js";
import {
  nextMountedTabLru,
  mountedTabState,
  DEFAULT_MOUNTED_TAB_CAP,
} from "../../workspace/keepalive.js";
import {
  splitDepth,
  findPane,
  listPanes,
  defaultWorkspaceLayout,
  MAX_SPLIT_DEPTH,
  type SplitNode,
  type SplitGroup,
} from "../../workspace/layout.js";
import {
  workspaceHeaderModel,
  type HeaderInput,
} from "../../workspace/composition.js";
import {
  buildMobileSwitcher,
  compactVisibleTabs,
} from "../../workspace/mobile-switcher.js";
import {
  classifyBulkClose,
  bulkCloseConfirmation,
  planBulkClose,
} from "../../workspace/bulk-close.js";
import type { WorkspaceTab } from "../../workspace/tabs.js";
import type { AgentForSubagentPolicy } from "../../workspace/subagents.js";

// ---------------------------------------------------------------------------
// Width distribution
// ---------------------------------------------------------------------------
describe("distributeTabWidths", () => {
  it("0 tabs → empty", () => {
    expect(distributeTabWidths(0, 800)).toEqual({ widths: [], scroll: false });
  });

  it("fits all at max width when space allows", () => {
    const result = distributeTabWidths(3, 900);
    expect(result.widths).toEqual([TAB_MAX_WIDTH, TAB_MAX_WIDTH, TAB_MAX_WIDTH]);
    expect(result.scroll).toBe(false);
  });

  it("shrinks when constrained", () => {
    const result = distributeTabWidths(4, 400);
    expect(result.widths.every((w) => w >= TAB_ICON_MIN_WIDTH && w <= TAB_MAX_WIDTH)).toBe(true);
    expect(result.scroll).toBe(false);
  });

  it("enables scroll when below icon-min total", () => {
    const result = distributeTabWidths(20, 100);
    expect(result.scroll).toBe(true);
    expect(result.widths.every((w) => w === TAB_ICON_MIN_WIDTH)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Tab context menu
// ---------------------------------------------------------------------------
describe("tabContextMenu", () => {
  const mkTab = (kind: string): WorkspaceTab => ({
    tabId: `tab-${kind}`,
    target: { kind } as any,
    createdAt: Date.now(),
  });

  it("agent tab includes copy-resume, reload-agent", () => {
    const menu = tabContextMenu({ tab: mkTab("agent"), tabs: [mkTab("agent")], index: 0, formFactor: "desktop" });
    expect(menu.some((m) => m.id === "copy-resume")).toBe(true);
    expect(menu.some((m) => m.id === "reload-agent")).toBe(true);
  });

  it("non-agent tab excludes agent-specific items", () => {
    const menu = tabContextMenu({ tab: mkTab("file"), tabs: [mkTab("file")], index: 0, formFactor: "desktop" });
    expect(menu.some((m) => m.id === "copy-resume")).toBe(false);
  });

  it("close-to-left disabled at index 0", () => {
    const menu = tabContextMenu({ tab: mkTab("agent"), tabs: [mkTab("agent"), mkTab("file")], index: 0, formFactor: "desktop" });
    const item = menu.find((m) => m.id === "close-left");
    expect(item?.disabled).toBe(true);
  });

  it("close-others disabled with single tab", () => {
    const menu = tabContextMenu({ tab: mkTab("file"), tabs: [mkTab("file")], index: 0, formFactor: "desktop" });
    const item = menu.find((m) => m.id === "close-others");
    expect(item?.disabled).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Middle-click close
// ---------------------------------------------------------------------------
describe("isMiddleClickClose", () => {
  it("button=1 on web → true", () => {
    expect(isMiddleClickClose({ platform: "web", button: 1 })).toBe(true);
  });

  it("button=0 on web → false", () => {
    expect(isMiddleClickClose({ platform: "web", button: 0 })).toBe(false);
  });

  it("button=1 on desktop → true", () => {
    expect(isMiddleClickClose({ platform: "desktop", button: 1 })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Trailing actions
// ---------------------------------------------------------------------------
describe("trailingTabActions", () => {
  it("includes new-agent and new-terminal always", () => {
    const actions = trailingTabActions({ terminalCreating: false, electron: false, splitsSupported: false });
    expect(actions.some((a) => a.id === "new-agent")).toBe(true);
    expect(actions.some((a) => a.id === "new-terminal")).toBe(true);
  });

  it("includes new-browser on electron", () => {
    const actions = trailingTabActions({ terminalCreating: false, electron: true, splitsSupported: false });
    expect(actions.some((a) => a.id === "new-browser")).toBe(true);
  });

  it("disables new-terminal when creating", () => {
    const actions = trailingTabActions({ terminalCreating: true, electron: false, splitsSupported: false });
    expect(actions.find((a) => a.id === "new-terminal")?.disabled).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Pinned targets
// ---------------------------------------------------------------------------
describe("pinnedTargets", () => {
  it("toggle adds and removes", () => {
    const initial: PinnedTabTarget[] = [{ kind: "terminal" }];
    const added = togglePinnedTarget(initial, { kind: "browser" });
    expect(added.length).toBe(2);
    const removed = togglePinnedTarget(added, { kind: "browser" });
    expect(removed.length).toBe(1);
  });

  it("pinnedTargetKey for profile includes profileId", () => {
    expect(pinnedTargetKey({ kind: "profile", profileId: "x" })).toBe("profile:x");
  });

  it("migratePinnedTargets: invalid → defaults", () => {
    const state = migratePinnedTargets(null);
    expect(state.targets.length).toBeGreaterThanOrEqual(DEFAULT_PINNED_TARGETS.length);
  });

  it("quickLaunchButtons maps targets to tab targets", () => {
    const buttons = quickLaunchButtons(DEFAULT_PINNED_TARGETS, { nextDraftId: "d1", nextTerminalId: "t1", nextBrowserId: "b1" });
    expect(buttons.length).toBe(2);
    expect(buttons[0]!.tabTarget.kind).toBe("terminal");
    expect(buttons[1]!.tabTarget.kind).toBe("browser");
  });

  it("PinnedTargetsStore toggle persists", () => {
    const mem = new Map<string, string>();
    const storage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => mem.set(k, v), removeItem: (k: string) => mem.delete(k) };
    const store = new PinnedTargetsStore(storage);
    store.toggle({ kind: "draft" });
    const loaded = store.load();
    expect(loaded.targets.some((t) => t.kind === "draft")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Pane/split tree (task-003)
// ---------------------------------------------------------------------------
describe("pane/split layout", () => {
  it("defaultWorkspaceLayout creates a single pane", () => {
    const layout = defaultWorkspaceLayout(["t1"]);
    expect(layout.root.kind).toBe("pane");
    expect(listPanes(layout.root)).toHaveLength(1);
  });

  it("splitDepth of single pane = 1", () => {
    expect(splitDepth({ kind: "pane", id: "p", tabIds: [] })).toBe(1);
  });

  it("splitDepth of nested group", () => {
    const group: SplitGroup = {
      kind: "group",
      id: "g",
      direction: "row",
      sizes: [0.5, 0.5],
      children: [
        { kind: "pane", id: "a", tabIds: [] },
        { kind: "group", id: "g2", direction: "column", sizes: [0.5, 0.5], children: [
          { kind: "pane", id: "b", tabIds: [] },
          { kind: "pane", id: "c", tabIds: [] },
        ] },
      ],
    };
    expect(splitDepth(group)).toBe(3);
  });

  it("findPane locates nested pane", () => {
    const group: SplitGroup = {
      kind: "group", id: "g", direction: "row", sizes: [0.5, 0.5],
      children: [{ kind: "pane", id: "a", tabIds: ["t1"] }, { kind: "pane", id: "b", tabIds: [] }],
    };
    expect(findPane(group, "b")?.id).toBe("b");
    expect(findPane(group, "x")).toBeNull();
  });

  it("MAX_SPLIT_DEPTH = 4", () => {
    expect(MAX_SPLIT_DEPTH).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// DnD drop position (task-003)
// ---------------------------------------------------------------------------
describe("resolvePaneDropPosition", () => {
  const rect: DropRect = { x: 0, y: 0, width: 100, height: 100 };

  it("left edge → split left", () => {
    expect(resolvePaneDropPosition(rect, { x: 5, y: 50 }, 0)).toEqual({ kind: "split", side: "left" });
  });

  it("right edge → split right", () => {
    expect(resolvePaneDropPosition(rect, { x: 95, y: 50 }, 0)).toEqual({ kind: "split", side: "right" });
  });

  it("top edge → split top", () => {
    expect(resolvePaneDropPosition(rect, { x: 50, y: 5 }, 0)).toEqual({ kind: "split", side: "top" });
  });

  it("center with 0 tabs → move", () => {
    expect(resolvePaneDropPosition(rect, { x: 50, y: 50 }, 0)).toEqual({ kind: "move" });
  });

  it("center with tabs → reorder", () => {
    const result = resolvePaneDropPosition(rect, { x: 50, y: 50 }, 3);
    expect(result.kind).toBe("reorder");
  });

  it("supportsPaneSplits: web non-compact → true", () => {
    expect(supportsPaneSplits("web", false)).toBe(true);
    expect(supportsPaneSplits("web", true)).toBe(false);
    expect(supportsPaneSplits("ios", false)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Keepalive LRU (task-003)
// ---------------------------------------------------------------------------
describe("keepalive LRU", () => {
  it("nextMountedTabLru promotes active to front", () => {
    const lru = nextMountedTabLru(["a", "b", "c"], "d");
    expect(lru[0]).toBe("d");
    expect(lru.length).toBe(DEFAULT_MOUNTED_TAB_CAP);
  });

  it("nextMountedTabLru caps at 3", () => {
    const lru = nextMountedTabLru(["a", "b", "c"], "d", 3);
    expect(lru).toEqual(["d", "a", "b"]);
  });

  it("mountedTabState: active", () => {
    expect(mountedTabState("t1", "t1", ["t1"])).toBe("active");
  });

  it("mountedTabState: mounted-hidden", () => {
    expect(mountedTabState("t2", "t1", ["t1", "t2"])).toBe("mounted-hidden");
  });

  it("mountedTabState: unmounted", () => {
    expect(mountedTabState("t3", "t1", ["t1", "t2"])).toBe("unmounted");
  });
});

// ---------------------------------------------------------------------------
// Workspace header model (task-004)
// ---------------------------------------------------------------------------
describe("workspaceHeaderModel", () => {
  const baseInput: HeaderInput = {
    loading: false,
    title: "My workspace",
    projectSubtitle: "my-project",
    branch: "main",
    detachedHead: false,
    projectKind: "git",
    formFactor: "wide",
    scriptsCount: 2,
    workspaceDir: "/tmp/ws",
    setupAvailable: false,
    terminalReady: true,
    isElectron: false,
  };

  it("wide: shows title + branch + sidebar toggle", () => {
    const model = workspaceHeaderModel(baseInput);
    expect(model.left.title).toBe("My workspace");
    expect(model.left.branch).toBe("main");
    expect(model.left.sidebarToggle).toBe(true);
  });

  it("hides branch on non-git project", () => {
    const model = workspaceHeaderModel({ ...baseInput, projectKind: "non_git" });
    expect(model.left.branch).toBeUndefined();
  });

  it("right actions include scripts + explorer when present", () => {
    const model = workspaceHeaderModel(baseInput);
    expect(model.right.some((a) => a.id === "scripts")).toBe(true);
    expect(model.right.some((a) => a.id === "git-explorer")).toBe(true);
  });

  it("menu items include new-agent + new-terminal", () => {
    const model = workspaceHeaderModel(baseInput);
    expect(model.menuItems.some((i) => i.id === "new-agent")).toBe(true);
    expect(model.menuItems.some((i) => i.id === "new-terminal")).toBe(true);
  });

  it("loading state: empty title", () => {
    const model = workspaceHeaderModel({ ...baseInput, loading: true });
    expect(model.left.title).toBe("");
  });
});

// ---------------------------------------------------------------------------
// Compact switcher model (task-004)
// ---------------------------------------------------------------------------
describe("compact switcher", () => {
  const mkTab = (id: string): WorkspaceTab => ({ tabId: id, target: { kind: "agent", agentId: id } as any, createdAt: Date.now() });

  it("buildMobileSwitcher returns entries for all tabs", () => {
    const model = buildMobileSwitcher({
      tabs: [mkTab("a"), mkTab("b")],
      activeTabId: "a",
      pinnedTargets: [{ kind: "terminal" }],
      nextDraftId: "d1",
      nextTerminalId: "t1",
      nextBrowserId: "b1",
    });
    expect(model.entries.length).toBe(2);
    expect(model.entries[0]!.active).toBe(true);
    expect(model.splitsVisible).toBe(false);
    expect(model.newTabActions.length).toBeGreaterThan(0);
  });

  it("compactVisibleTabs returns only active tab", () => {
    const tabs = [mkTab("a"), mkTab("b")];
    expect(compactVisibleTabs(tabs, "b").length).toBe(1);
    expect(compactVisibleTabs(tabs, "b")[0]!.tabId).toBe("b");
  });
});

// ---------------------------------------------------------------------------
// Bulk close (task-004)
// ---------------------------------------------------------------------------
describe("bulk close", () => {
  const agentTab = (id: string): WorkspaceTab => ({ tabId: `tab-${id}`, target: { kind: "agent", agentId: id } as any, createdAt: Date.now() });
  const terminalTab = (id: string): WorkspaceTab => ({ tabId: `tab-term-${id}`, target: { kind: "terminal", terminalId: id } as any, createdAt: Date.now() });
  const fileTab = (id: string): WorkspaceTab => ({ tabId: `tab-file-${id}`, target: { kind: "file", path: `/f/${id}` } as any, createdAt: Date.now() });

  it("classifies agent tabs for archive", () => {
    const agents: AgentForSubagentPolicy[] = [{ agentId: "a1", status: "idle" }];
    const classification = classifyBulkClose([agentTab("a1")], agents);
    expect(classification.archiveAgentIds.length + classification.layoutOnlyAgentIds.length).toBe(1);
  });

  it("classifies terminal tabs", () => {
    const classification = classifyBulkClose([terminalTab("t1")], []);
    expect(classification.closeTerminalIds).toEqual(["t1"]);
  });

  it("classifies file tabs as local-only", () => {
    const classification = classifyBulkClose([fileTab("f1")], []);
    expect(classification.localOnlyTabIds).toEqual(["tab-file-f1"]);
  });

  it("confirmation wording mentions archives and terminals", () => {
    const plan = planBulkClose([agentTab("a1"), terminalTab("t1"), fileTab("f1")], [{ agentId: "a1", status: "idle" }]);
    expect(plan.confirmation).toContain("terminal");
    expect(plan.closingTabIds.length).toBe(3);
  });

  it("empty tabs → no tabs to close", () => {
    expect(bulkCloseConfirmation({ archiveAgentIds: [], layoutOnlyAgentIds: [], closeTerminalIds: [], localOnlyTabIds: [] })).toBe("No tabs to close.");
  });
});
