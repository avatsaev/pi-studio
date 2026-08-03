import { beforeEach, describe, expect, it } from "vitest";
import { useTabStore, openNewChat, openNewMolecule, tabIds, type Tab } from "./tab-store.js";
import { isPaneActiveTab, useLayoutStore } from "./layout-store.js";
import { canSplit, leafIds } from "@pi-studio-ui/features/workspace/pane-tree.js";
import { useSessionStore } from "./session-store.js";
import {
  resetLayoutStore,
  resetSessionStore,
  resetTabStore,
} from "@pi-studio-ui/test/reset-stores.js";

beforeEach(() => {
  resetTabStore();
  // Pane structure is the layout store's now, so it has to be reset alongside the tabs it places —
  // a stale placement would let a fallback name a tab that no longer exists.
  resetLayoutStore();
  resetSessionStore();
});

function chatTab(id: string, sessionId: string, workspaceCwd = "/work"): Tab {
  return { id, kind: "chat", label: id, closable: true, data: { sessionId }, workspaceCwd };
}

function terminalTab(id: string, workspaceCwd = "/work"): Tab {
  return {
    id,
    kind: "terminal",
    label: id,
    closable: true,
    data: { slot: null, cwd: workspaceCwd },
    workspaceCwd,
  };
}

function fileTab(path: string, workspaceCwd = "/work"): Tab {
  return {
    id: `file-${path}`,
    kind: "file",
    label: path,
    closable: true,
    data: { path },
    workspaceCwd,
  };
}

describe("tab store — sidebar/session sync", () => {
  it("open()'ing a new chat tab activates its session, mirroring a sidebar click", () => {
    useTabStore.getState().open(chatTab("chat-s1", "s1"));
    expect(useSessionStore.getState().activeSessionId).toBe("s1");
  });

  it("activate() on a chat tab switches the sidebar's highlighted session to match", () => {
    useTabStore.getState().open(chatTab("chat-s1", "s1"));
    useTabStore.getState().open(chatTab("chat-s2", "s2"));
    expect(useSessionStore.getState().activeSessionId).toBe("s2");

    useTabStore.getState().activate("chat-s1");
    expect(useTabStore.getState().activeTabId).toBe("chat-s1");
    expect(useSessionStore.getState().activeSessionId).toBe("s1");
  });

  it("re-open()'ing an already-open chat tab (existing-tab branch) re-syncs the sidebar", () => {
    useTabStore.getState().open(chatTab("chat-s1", "s1"));
    useTabStore.getState().open(chatTab("chat-s2", "s2"));
    useTabStore.getState().open(chatTab("chat-s1", "s1"));
    expect(useSessionStore.getState().activeSessionId).toBe("s1");
  });

  it("activate() on a non-chat tab (terminal) leaves the sidebar's active session untouched", () => {
    useTabStore.getState().open(chatTab("chat-s1", "s1"));
    useTabStore.getState().open(terminalTab("term-1"));
    useTabStore.getState().activate("term-1");
    expect(useTabStore.getState().activeTabId).toBe("term-1");
    expect(useSessionStore.getState().activeSessionId).toBe("s1");
  });

  it("close()'ing the active chat tab syncs the sidebar to the sibling it falls back to", () => {
    useTabStore.getState().open(chatTab("chat-s1", "s1"));
    useTabStore.getState().open(chatTab("chat-s2", "s2"));
    useTabStore.getState().close("chat-s2");
    expect(useTabStore.getState().activeTabId).toBe("chat-s1");
    expect(useSessionStore.getState().activeSessionId).toBe("s1");
  });

  it("close()'ing a background (non-active) tab never touches the sidebar's active session", () => {
    useTabStore.getState().open(chatTab("chat-s1", "s1"));
    useTabStore.getState().open(chatTab("chat-s2", "s2"));
    useTabStore.getState().close("chat-s1");
    expect(useTabStore.getState().activeTabId).toBe("chat-s2");
    expect(useSessionStore.getState().activeSessionId).toBe("s2");
  });

  it("switchWorkspace() restoring a remembered chat tab syncs the sidebar to match", () => {
    useTabStore.getState().open(chatTab("chat-s1", "s1", "/work-a"));
    useTabStore.getState().open(chatTab("chat-s2", "s2", "/work-b"));
    expect(useSessionStore.getState().activeSessionId).toBe("s2");

    useTabStore.getState().switchWorkspace("/work-a");
    expect(useTabStore.getState().activeTabId).toBe("chat-s1");
    expect(useSessionStore.getState().activeSessionId).toBe("s1");
  });

  it("focusing another pane re-projects the active tab and the sidebar's session", () => {
    // The path the UI actually takes: the strip/panel-host `onPointerDown` calls `layout-store`
    // directly, so nothing in this store runs. The status bar reads `activeSessionId`, which is why a
    // stale projection showed the previously focused conversation's model, context and cost.
    const cwd = "/work";
    useTabStore.getState().open(chatTab("chat-s1", "s1"));
    const left = useLayoutStore.getState().layouts[cwd]!.focusedPaneId;
    const right = useLayoutStore.getState().splitEmpty(cwd, left, "right")!;
    useTabStore.getState().open(chatTab("chat-s2", "s2"), right);
    expect(useSessionStore.getState().activeSessionId).toBe("s2");

    useLayoutStore.getState().focusPane(cwd, left);

    expect(useTabStore.getState().activeTabId).toBe("chat-s1");
    expect(useSessionStore.getState().activeSessionId).toBe("s1");
  });

  it("focusing a pane whose active tab is a file keeps the last chat as the sidebar's session", () => {
    const cwd = "/work";
    useTabStore.getState().open(chatTab("chat-s1", "s1"));
    const left = useLayoutStore.getState().layouts[cwd]!.focusedPaneId;
    const right = useLayoutStore.getState().splitEmpty(cwd, left, "right")!;
    useTabStore.getState().open(fileTab("/work/a.ts"), right);

    useLayoutStore.getState().focusPane(cwd, left);
    useLayoutStore.getState().focusPane(cwd, right);

    expect(useTabStore.getState().activeTabId).toBe("file-/work/a.ts");
    expect(useSessionStore.getState().activeSessionId).toBe("s1");
  });

  it("a layout mutation that does not change the active tab re-projects nothing", () => {
    const cwd = "/work";
    useTabStore.getState().open(chatTab("chat-s1", "s1"));
    const left = useLayoutStore.getState().layouts[cwd]!.focusedPaneId;
    useLayoutStore.getState().splitEmpty(cwd, left, "right");
    const before = useTabStore.getState();

    // A divider drag mutates the layout on every frame; the projection must not churn.
    useLayoutStore.getState().resizeDivider(cwd, [], 0, 0.05);

    expect(useTabStore.getState()).toBe(before);
  });
});

describe("openNewMolecule", () => {
  it("opens an empty molecule tab with an incrementing label and the mol-new-<n> id shape", () => {
    openNewMolecule("/work");
    const tabs = useTabStore.getState().tabs;
    expect(tabs).toHaveLength(1);
    expect(tabs[0]).toMatchObject({
      id: tabIds.molecule("new-1"),
      kind: "molecule",
      label: "Molecule 1",
      closable: true,
      data: { path: null },
      workspaceCwd: "/work",
    });

    openNewMolecule("/work");
    const tabs2 = useTabStore.getState().tabs;
    expect(tabs2).toHaveLength(2);
    expect(tabs2[1]?.label).toBe("Molecule 2");
    expect(tabs2[1]?.id).not.toBe(tabs[0]?.id);
  });
});

describe("closeByPathPrefix", () => {
  it("closes a file tab matching the exact path", () => {
    useTabStore.getState().open(fileTab("/work/a.ts"));
    useTabStore.getState().closeByPathPrefix("/work/a.ts");
    expect(useTabStore.getState().tabs).toHaveLength(0);
  });

  it("closes every tab nested under a deleted directory", () => {
    useTabStore.getState().open(fileTab("/work/src/a.ts"));
    useTabStore.getState().open(fileTab("/work/src/b.ts"));
    useTabStore.getState().open(fileTab("/work/other.ts"));
    useTabStore.getState().closeByPathPrefix("/work/src");
    expect(useTabStore.getState().tabs.map((t) => t.id)).toEqual(["file-/work/other.ts"]);
  });

  it("does not close a sibling file whose name merely starts with the prefix", () => {
    useTabStore.getState().open(fileTab("/work/src.ts"));
    useTabStore.getState().closeByPathPrefix("/work/src");
    expect(useTabStore.getState().tabs).toHaveLength(1);
  });

  it("leaves chat/terminal tabs untouched", () => {
    useTabStore.getState().open(chatTab("chat-s1", "s1"));
    useTabStore.getState().open(terminalTab("term-1"));
    useTabStore.getState().closeByPathPrefix("/work");
    expect(useTabStore.getState().tabs).toHaveLength(2);
  });
});

// ─── Layout integration (sprint-049 task-001) ──────────────────────────────────────────────

/** The pane ids of a workspace's layout, in tree order. */
function panes(cwd = "/work"): string[] {
  return leafIds(useLayoutStore.getState().layouts[cwd]!.tree);
}

function layoutOf(cwd = "/work") {
  return useLayoutStore.getState().layouts[cwd]!;
}

function workspaceTabIds(cwd = "/work"): string[] {
  return useTabStore
    .getState()
    .tabs.filter((t) => t.workspaceCwd === cwd)
    .map((t) => t.id);
}

/** Split the focused pane and move `tabId` into the new pane; returns [source, created]. */
function splitRight(tabId: string, cwd = "/work"): [string, string] {
  const source = layoutOf(cwd).focusedPaneId;
  useLayoutStore.getState().splitWithTab(cwd, tabId, source, "right", workspaceTabIds(cwd));
  const created = panes(cwd).find((id) => id !== source)!;
  return [source, created];
}

describe("tab store — single pane behaves exactly as before panes existed", () => {
  it("open() activates the new tab and brings its workspace into view", () => {
    useTabStore.getState().open(chatTab("chat-s1", "s1"));
    useTabStore.getState().open(terminalTab("term-1"));
    expect(useTabStore.getState().activeTabId).toBe("term-1");
    expect(useTabStore.getState().activeWorkspaceCwd).toBe("/work");
    expect(panes()).toHaveLength(1);
  });

  it("close() falls back to the nearest sibling, then to null when the last tab goes", () => {
    useTabStore.getState().open(chatTab("chat-s1", "s1"));
    useTabStore.getState().open(chatTab("chat-s2", "s2"));
    useTabStore.getState().open(chatTab("chat-s3", "s3"));

    useTabStore.getState().activate("chat-s2");
    useTabStore.getState().close("chat-s2");
    expect(useTabStore.getState().activeTabId).toBe("chat-s3");

    useTabStore.getState().close("chat-s3");
    expect(useTabStore.getState().activeTabId).toBe("chat-s1");

    useTabStore.getState().close("chat-s1");
    expect(useTabStore.getState().activeTabId).toBeNull();
    // The last pane is never removed — it renders the "no open tabs" state instead.
    expect(panes()).toHaveLength(1);
  });

  it("closing a background tab leaves the active tab alone", () => {
    useTabStore.getState().open(chatTab("chat-s1", "s1"));
    useTabStore.getState().open(chatTab("chat-s2", "s2"));
    useTabStore.getState().close("chat-s1");
    expect(useTabStore.getState().activeTabId).toBe("chat-s2");
  });

  it("switchWorkspace() returns to the tab that workspace was left on", () => {
    useTabStore.getState().open(chatTab("chat-a1", "a1", "/work-a"));
    useTabStore.getState().open(chatTab("chat-a2", "a2", "/work-a"));
    useTabStore.getState().activate("chat-a1");
    useTabStore.getState().open(chatTab("chat-b1", "b1", "/work-b"));

    useTabStore.getState().switchWorkspace("/work-a");
    expect(useTabStore.getState().activeTabId).toBe("chat-a1");
    useTabStore.getState().switchWorkspace("/work-b");
    expect(useTabStore.getState().activeTabId).toBe("chat-b1");
  });

  it("switchWorkspace() to a workspace with no tabs reports no active tab", () => {
    useTabStore.getState().open(chatTab("chat-a1", "a1", "/work-a"));
    useTabStore.getState().switchWorkspace("/work-empty");
    expect(useTabStore.getState().activeTabId).toBeNull();
    expect(useTabStore.getState().activeWorkspaceCwd).toBe("/work-empty");
  });
});

describe("tab store — two panes", () => {
  it("closing the focused pane's last tab collapses it and falls back to the survivor", () => {
    useTabStore.getState().open(chatTab("chat-s1", "s1"));
    useTabStore.getState().open(chatTab("chat-s2", "s2"));
    const [source, created] = splitRight("chat-s2");
    expect(layoutOf().focusedPaneId).toBe(created);

    useTabStore.getState().close("chat-s2");
    expect(panes()).toEqual([source]);
    expect(useTabStore.getState().activeTabId).toBe("chat-s1");
  });

  it("a tab active in a non-focused pane is visible while activeTabId names another tab", () => {
    useTabStore.getState().open(chatTab("chat-s1", "s1"));
    useTabStore.getState().open(chatTab("chat-s2", "s2"));
    const [source] = splitRight("chat-s2");

    // chat-s2 is focused and active; chat-s1 is the *other* pane's active tab.
    expect(useTabStore.getState().activeTabId).toBe("chat-s2");
    expect(isPaneActiveTab(layoutOf(), "chat-s1")).toBe(true);
    expect(layoutOf().activeByPane[source]).toBe("chat-s1");
  });

  it("activate() on a tab in the unfocused pane focuses that pane", () => {
    useTabStore.getState().open(chatTab("chat-s1", "s1"));
    useTabStore.getState().open(chatTab("chat-s2", "s2"));
    const [source, created] = splitRight("chat-s2");

    useTabStore.getState().activate("chat-s1");
    expect(layoutOf().focusedPaneId).toBe(source);
    expect(useTabStore.getState().activeTabId).toBe("chat-s1");
    // The other pane keeps showing its own active tab — activation is per pane.
    expect(layoutOf().activeByPane[created]).toBe("chat-s2");
    expect(isPaneActiveTab(layoutOf(), "chat-s2")).toBe(true);
  });

  it("re-open()'ing an existing tab focuses its pane instead of re-placing it", () => {
    useTabStore.getState().open(chatTab("chat-s1", "s1"));
    useTabStore.getState().open(chatTab("chat-s2", "s2"));
    const [source, created] = splitRight("chat-s2");
    useTabStore.getState().activate("chat-s1");

    useTabStore.getState().open(chatTab("chat-s2", "s2"));
    expect(useTabStore.getState().tabs).toHaveLength(2);
    expect(layoutOf().placement["chat-s2"]).toBe(created);
    expect(layoutOf().focusedPaneId).toBe(created);
    expect(layoutOf().placement["chat-s1"]).toBe(source);
  });

  it("switchWorkspace() restores the focused pane, not just the active tab", () => {
    useTabStore.getState().open(chatTab("chat-a1", "a1", "/work-a"));
    useTabStore.getState().open(chatTab("chat-a2", "a2", "/work-a"));
    const [source] = splitRight("chat-a2", "/work-a");
    useTabStore.getState().activate("chat-a1");
    expect(layoutOf("/work-a").focusedPaneId).toBe(source);

    useTabStore.getState().open(chatTab("chat-b1", "b1", "/work-b"));
    useTabStore.getState().switchWorkspace("/work-a");
    expect(layoutOf("/work-a").focusedPaneId).toBe(source);
    expect(useTabStore.getState().activeTabId).toBe("chat-a1");
  });

  it("a tab in a workspace that is not in view is never visible", () => {
    useTabStore.getState().open(chatTab("chat-a1", "a1", "/work-a"));
    useTabStore.getState().open(chatTab("chat-b1", "b1", "/work-b"));
    // /work-b is in view; chat-a1 is still its own pane's active tab in /work-a.
    expect(isPaneActiveTab(layoutOf("/work-a"), "chat-a1")).toBe(true);
    expect(useTabStore.getState().activeWorkspaceCwd).toBe("/work-b");
  });
});

// ─── Targeted opens + programmatic splits (sprint-049 task-005) ────────────────────────────

describe("tab store — opening into a named pane", () => {
  it("places a tab in the target pane instead of the focused one, and focuses it", () => {
    useTabStore.getState().open(chatTab("chat-s1", "s1"));
    useTabStore.getState().open(chatTab("chat-s2", "s2"));
    const [source, created] = splitRight("chat-s2");
    expect(layoutOf().focusedPaneId).toBe(created);

    useTabStore.getState().open(chatTab("chat-s3", "s3"), source);
    expect(layoutOf().placement["chat-s3"]).toBe(source);
    expect(layoutOf().focusedPaneId).toBe(source);
    expect(useTabStore.getState().activeTabId).toBe("chat-s3");
    // The other pane keeps its own active tab.
    expect(layoutOf().activeByPane[created]).toBe("chat-s2");
  });

  it("falls back to the focused pane when the target pane does not exist", () => {
    useTabStore.getState().open(chatTab("chat-s1", "s1"));
    const pane = layoutOf().focusedPaneId;
    useTabStore.getState().open(chatTab("chat-s2", "s2"), "pane-ghost");
    expect(layoutOf().placement["chat-s2"]).toBe(pane);
  });

  it("openNewMolecule targets a pane when asked, and the focused pane when not", () => {
    useTabStore.getState().open(chatTab("chat-s1", "s1"));
    useTabStore.getState().open(chatTab("chat-s2", "s2"));
    const [source, created] = splitRight("chat-s2");

    openNewMolecule("/work", source);
    const targeted = useTabStore.getState().tabs.at(-1)!.id;
    expect(layoutOf().placement[targeted]).toBe(source);

    // No target: the focused pane, which the targeted open above just changed to `source`.
    openNewMolecule("/work");
    const untargeted = useTabStore.getState().tabs.at(-1)!.id;
    expect(layoutOf().placement[untargeted]).toBe(source);
    expect(created).not.toBe(source);
  });
});

describe("layout store — programmatic split + seed", () => {
  /** What a Split right/down button does: split, then open a chat into the pane it returned. */
  function splitAndSeed(region: "right" | "bottom"): string | null {
    const paneId = layoutOf().focusedPaneId;
    const created = useLayoutStore.getState().splitEmpty("/work", paneId, region);
    if (created !== null) openNewChat("/work", created);
    return created;
  }

  it("seeds the new pane so it is never empty, focused and active", () => {
    useTabStore.getState().open(chatTab("chat-s1", "s1"));
    const created = splitAndSeed("right");
    expect(created).not.toBeNull();
    const seeded = useTabStore.getState().tabs.at(-1)!.id;
    expect(layoutOf().placement[seeded]).toBe(created);
    expect(layoutOf().activeByPane[created!]).toBe(seeded);
    expect(layoutOf().focusedPaneId).toBe(created);
    expect(useTabStore.getState().activeTabId).toBe(seeded);
  });

  it("repeated Split right produces one flat row run, not nested pairs", () => {
    useTabStore.getState().open(chatTab("chat-s1", "s1"));
    splitAndSeed("right");
    splitAndSeed("right");
    splitAndSeed("right");
    const tree = layoutOf().tree;
    expect(tree.kind).toBe("split");
    if (tree.kind !== "split") throw new Error("expected a split");
    expect(tree.direction).toBe("row");
    expect(tree.children).toHaveLength(4);
    expect(tree.children.every((child) => child.kind === "leaf")).toBe(true);
  });

  it("refuses a perpendicular split at the depth cap, leaving the same-direction one legal", () => {
    useTabStore.getState().open(chatTab("chat-s1", "s1"));
    // Nest perpendicular each time to actually spend depth: row → column → row.
    splitAndSeed("right");
    splitAndSeed("bottom");
    splitAndSeed("right");
    const deepest = layoutOf().focusedPaneId;
    const tree = layoutOf().tree;
    // This is exactly the predicate the buttons' disabled state reads.
    expect(canSplit(tree, deepest, "right")).toBe(true);
    expect(canSplit(tree, deepest, "bottom")).toBe(false);
    // And a refused split changes nothing at all.
    const before = layoutOf();
    expect(useLayoutStore.getState().splitEmpty("/work", deepest, "bottom")).toBeNull();
    expect(useLayoutStore.getState().layouts["/work"]).toBe(before);
  });
});
