/**
 * The dispatch half of a sidebar-to-pane drag. The hook itself cannot be: this project's vitest
 * config runs `.test.ts` under plain Node with no DOM, so the gesture wiring is smoke-tested and
 * `applyExternalDrop` — which is all of the behaviour — is driven directly.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { applyExternalDrop } from "./use-external-pane-drop.js";
import { useLayoutStore } from "@pi-studio-ui/stores/layout-store.js";
import { useSessionStore, type SessionEntry } from "@pi-studio-ui/stores/session-store.js";
import { useTabStore, tabIds } from "@pi-studio-ui/stores/tab-store.js";
import { leafIds } from "@pi-studio-ui/features/workspace/pane-tree.js";
import { EMPTY_TIMELINE } from "@pi-studio-ui/timeline/reducer.js";
import type { ExternalDragPayload } from "@pi-studio-ui/features/workspace/external-drag.js";

const CWD = "/work";

beforeEach(() => {
  useLayoutStore.setState({
    layouts: {},
    hydrationSources: { sessions: false, terminals: false },
    restoring: false,
  });
  useTabStore.setState({ tabs: [], activeTabId: null, activeWorkspaceCwd: null });
  useSessionStore.setState({ sessions: {}, order: [], activeSessionId: null });
});

function session(id: string, cwd = CWD): SessionEntry {
  return {
    id,
    agentId: `a-${id}`,
    title: `Chat ${id}`,
    status: "idle",
    cwd,
    timeline: EMPTY_TIMELINE,
    userMessageCount: 0,
  };
}

function seedSession(id: string, cwd = CWD): void {
  useSessionStore.setState((s) => ({
    sessions: { ...s.sessions, [id]: session(id, cwd) },
    order: [...s.order, id],
  }));
}

/** A single-pane workspace with one open chat tab, which is the pane's active tab. */
function seedOnePaneWithChat(sessionId: string): string {
  seedSession(sessionId);
  useLayoutStore.getState().ensureWorkspace(CWD);
  useTabStore.getState().open({
    id: tabIds.chat(sessionId),
    kind: "chat",
    label: "seed",
    closable: true,
    data: { sessionId },
    workspaceCwd: CWD,
  });
  return useLayoutStore.getState().layouts[CWD]!.focusedPaneId;
}

const layout = () => useLayoutStore.getState().layouts[CWD]!;
const tabIdsInStore = () =>
  useTabStore
    .getState()
    .tabs.map((t) => t.id)
    .toSorted();

const chatDrag = (sessionId: string): ExternalDragPayload => ({ kind: "chat", value: sessionId });
const pathDrag = (path: string): ExternalDragPayload => ({ kind: "path", value: path });

describe("dropping something with no tab yet", () => {
  it("opens a chat into the pane it was dropped on", () => {
    const pane = seedOnePaneWithChat("s1");
    seedSession("s2");

    applyExternalDrop(chatDrag("s2"), CWD, pane, "center", null);

    expect(tabIdsInStore()).toEqual(["chat-s1", "chat-s2"]);
    expect(layout().placement["chat-s2"]).toBe(pane);
    expect(layout().activeByPane[pane]).toBe("chat-s2");
    expect(leafIds(layout().tree)).toHaveLength(1);
  });

  it("splits the pane and opens the chat in the new one", () => {
    const pane = seedOnePaneWithChat("s1");
    seedSession("s2");

    applyExternalDrop(chatDrag("s2"), CWD, pane, "right", null);

    const panes = leafIds(layout().tree);
    expect(panes).toHaveLength(2);
    const created = panes.find((id) => id !== pane)!;
    // The tab opens straight into its final home: it must never land in the dropped-on pane first.
    expect(layout().placement["chat-s2"]).toBe(created);
    expect(layout().activeByPane[created]).toBe("chat-s2");
    // The source pane keeps its own tab — a split adds a pane, it does not move anything.
    expect(layout().activeByPane[pane]).toBe("chat-s1");
    expect(layout().focusedPaneId).toBe(created);
  });

  it("opens a file, choosing the viewer kind the path implies", () => {
    const pane = seedOnePaneWithChat("s1");

    applyExternalDrop(pathDrag("/work/a.ts"), CWD, pane, "bottom", null);
    applyExternalDrop(pathDrag("/work/mol.cif"), CWD, pane, "center", null);

    // `.cif` is a molecule extension, `.ts` is not — the shared `openFileTab` dispatch decides, so a
    // dragged path and a clicked row can never disagree about which panel opens.
    expect(tabIdsInStore()).toEqual(["chat-s1", "file-/work/a.ts", "mol-/work/mol.cif"]);
  });

  it("ignores a chat whose session is gone", () => {
    const pane = seedOnePaneWithChat("s1");
    // A row dragged from a list that has since been pruned: nothing to open, and nothing may break.
    applyExternalDrop(chatDrag("s-missing"), CWD, pane, "right", null);
    expect(tabIdsInStore()).toEqual(["chat-s1"]);
  });

  it("does nothing when the workspace has no layout at all", () => {
    seedSession("s2");
    applyExternalDrop(chatDrag("s2"), CWD, "P0", "center", null);
    expect(tabIdsInStore()).toEqual([]);
  });
});

describe("dropping something already open", () => {
  it("moves the existing tab instead of opening a duplicate", () => {
    const first = seedOnePaneWithChat("s1");
    seedSession("s2");
    applyExternalDrop(chatDrag("s2"), CWD, first, "right", null);
    const second = leafIds(layout().tree).find((id) => id !== first)!;

    // Drag the sidebar row of a chat that is already open in the other pane.
    applyExternalDrop(chatDrag("s1"), CWD, second, "center", null);

    expect(tabIdsInStore()).toEqual(["chat-s1", "chat-s2"]);
    expect(layout().placement["chat-s1"]).toBe(second);
    // Its old pane is gone: it held nothing else, so the tree collapsed back to one pane.
    expect(leafIds(layout().tree)).toEqual([second]);
  });

  it("splits with the existing tab rather than reopening it", () => {
    const pane = seedOnePaneWithChat("s1");
    seedSession("s2");
    applyExternalDrop(chatDrag("s2"), CWD, pane, "center", null);
    expect(layout().activeByPane[pane]).toBe("chat-s2");

    applyExternalDrop(chatDrag("s1"), CWD, pane, "bottom", null);

    const panes = leafIds(layout().tree);
    expect(panes).toHaveLength(2);
    expect(tabIdsInStore()).toEqual(["chat-s1", "chat-s2"]);
    const created = panes.find((id) => id !== pane)!;
    expect(layout().placement["chat-s1"]).toBe(created);
    expect(layout().placement["chat-s2"]).toBe(pane);
  });

  it("is a no-op dropped on the centre of the pane it already occupies", () => {
    const pane = seedOnePaneWithChat("s1");
    const before = layout();

    applyExternalDrop(chatDrag("s1"), CWD, pane, "center", null);

    // Same guard an internal tab drag uses — the sidebar path must not diverge from it.
    expect(useLayoutStore.getState().layouts[CWD]).toBe(before);
    expect(tabIdsInStore()).toEqual(["chat-s1"]);
  });

  it("is a no-op splitting a pane off its own only tab", () => {
    const pane = seedOnePaneWithChat("s1");
    const before = layout();

    // The new pane would take the tab and the source would collapse straight back.
    applyExternalDrop(chatDrag("s1"), CWD, pane, "right", null);

    expect(useLayoutStore.getState().layouts[CWD]).toBe(before);
    expect(leafIds(layout().tree)).toEqual([pane]);
  });

  it("finds a path already open as a molecule tab", () => {
    const pane = seedOnePaneWithChat("s1");
    applyExternalDrop(pathDrag("/work/mol.cif"), CWD, pane, "center", null);
    expect(tabIdsInStore()).toEqual(["chat-s1", "mol-/work/mol.cif"]);

    // Dragging the same row again must reuse the molecule tab, not open a second `file-` tab for it.
    applyExternalDrop(pathDrag("/work/mol.cif"), CWD, pane, "right", null);

    expect(tabIdsInStore()).toEqual(["chat-s1", "mol-/work/mol.cif"]);
    expect(leafIds(layout().tree)).toHaveLength(2);
  });
});
