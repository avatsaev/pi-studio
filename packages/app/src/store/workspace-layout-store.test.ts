/**
 * Workspace tab layout store tests — sprint-024 / task-001
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  useWorkspaceLayoutStore,
} from "./workspace-layout-store.js";
import { createMemoryLayoutStorage, WorkspaceLayoutStore } from "../workspace/layout-store.js";
import { listPanes } from "../workspace/layout.js";

function reset() {
  useWorkspaceLayoutStore.setState({
    workspaces: {},
    _storage: createMemoryLayoutStorage(),
    _saveTimers: {},
  });
}

const SRV = "srv1";
const WS = "ws1";

describe("WorkspaceLayoutStore — initWorkspace", () => {
  beforeEach(reset);

  it("creates a workspace with a seeded agent tab", () => {
    useWorkspaceLayoutStore.getState().initWorkspace(SRV, WS, "agent1");
    const ws = useWorkspaceLayoutStore.getState().workspaces[`${SRV}:${WS}`]!;
    expect(ws.hydrated).toBe(true);
    const tabIds = Object.keys(ws.tabs);
    expect(tabIds).toHaveLength(1);
    const tab = ws.tabs[tabIds[0]!]!;
    expect(tab.tab.target.kind).toBe("agent");
  });

  it("seeds a draft tab when no agentId", () => {
    useWorkspaceLayoutStore.getState().initWorkspace(SRV, WS);
    const ws = useWorkspaceLayoutStore.getState().workspaces[`${SRV}:${WS}`]!;
    const tabIds = Object.keys(ws.tabs);
    expect(ws.tabs[tabIds[0]!]?.tab.target.kind).toBe("draft");
  });

  it("restores layout from KV on re-init", () => {
    const storage = createMemoryLayoutStorage();
    useWorkspaceLayoutStore.getState().setStorage(storage);
    useWorkspaceLayoutStore.getState().initWorkspace(SRV, WS, "agent1");

    const ws = useWorkspaceLayoutStore.getState().workspaces[`${SRV}:${WS}`]!;
    const tabId = Object.keys(ws.tabs)[0]!;

    // Force-save to storage
    new WorkspaceLayoutStore(storage).save(SRV, WS, ws.layout);

    // Re-init should restore
    reset();
    useWorkspaceLayoutStore.getState().setStorage(storage);
    useWorkspaceLayoutStore.getState().initWorkspace(SRV, WS, "agent1");
    const restored = useWorkspaceLayoutStore.getState().workspaces[`${SRV}:${WS}`]!;
    expect(restored.hydrated).toBe(true);
    // The layout root should still contain the tab
    const panes = listPanes(restored.layout.root);
    expect(panes.length).toBeGreaterThan(0);
  });
});

describe("WorkspaceLayoutStore — openTab", () => {
  beforeEach(reset);

  it("opens a new tab and returns its id", () => {
    useWorkspaceLayoutStore.getState().initWorkspace(SRV, WS, "agent1");
    const tabId = useWorkspaceLayoutStore.getState().openTab(SRV, WS, {
      kind: "terminal",
      terminalId: "term1",
    });
    const ws = useWorkspaceLayoutStore.getState().workspaces[`${SRV}:${WS}`]!;
    expect(ws.tabs[tabId]).toBeDefined();
    expect(ws.tabs[tabId]?.tab.target.kind).toBe("terminal");
  });

  it("deduplicates tabs with the same target", () => {
    useWorkspaceLayoutStore.getState().initWorkspace(SRV, WS, "agent1");
    const id1 = useWorkspaceLayoutStore.getState().openTab(SRV, WS, { kind: "terminal", terminalId: "t1" });
    const id2 = useWorkspaceLayoutStore.getState().openTab(SRV, WS, { kind: "terminal", terminalId: "t1" });
    expect(id1).toBe(id2);
    const ws = useWorkspaceLayoutStore.getState().workspaces[`${SRV}:${WS}`]!;
    const terminalTabs = Object.values(ws.tabs).filter((r) => r.tab.target.kind === "terminal");
    expect(terminalTabs).toHaveLength(1);
  });

  it("adds tab to tabOrder", () => {
    useWorkspaceLayoutStore.getState().initWorkspace(SRV, WS, "agent1");
    const before = useWorkspaceLayoutStore.getState().workspaces[`${SRV}:${WS}`]!.tabOrder.length;
    useWorkspaceLayoutStore.getState().openTab(SRV, WS, { kind: "terminal", terminalId: "t2" });
    const after = useWorkspaceLayoutStore.getState().workspaces[`${SRV}:${WS}`]!.tabOrder.length;
    expect(after).toBe(before + 1);
  });
});

describe("WorkspaceLayoutStore — closeTab", () => {
  beforeEach(reset);

  it("closes an unpinned tab", () => {
    useWorkspaceLayoutStore.getState().initWorkspace(SRV, WS, "agent1");
    const tabId = useWorkspaceLayoutStore.getState().openTab(SRV, WS, { kind: "terminal", terminalId: "t1" });
    useWorkspaceLayoutStore.getState().closeTab(SRV, WS, tabId);
    const ws = useWorkspaceLayoutStore.getState().workspaces[`${SRV}:${WS}`]!;
    expect(ws.tabs[tabId]).toBeUndefined();
    expect(ws.tabOrder.includes(tabId)).toBe(false);
  });

  it("cannot close a pinned tab", () => {
    useWorkspaceLayoutStore.getState().initWorkspace(SRV, WS, "agent1");
    const tabId = useWorkspaceLayoutStore.getState().openTab(SRV, WS, { kind: "terminal", terminalId: "t1" });
    useWorkspaceLayoutStore.getState().setPinned(SRV, WS, tabId, true);
    useWorkspaceLayoutStore.getState().closeTab(SRV, WS, tabId);
    const ws = useWorkspaceLayoutStore.getState().workspaces[`${SRV}:${WS}`]!;
    expect(ws.tabs[tabId]).toBeDefined();
  });
});

describe("WorkspaceLayoutStore — reorderTab", () => {
  beforeEach(reset);

  it("reorders tabs in a pane", () => {
    useWorkspaceLayoutStore.getState().initWorkspace(SRV, WS, "agent1");
    useWorkspaceLayoutStore.getState().openTab(SRV, WS, { kind: "terminal", terminalId: "t1" });
    useWorkspaceLayoutStore.getState().openTab(SRV, WS, { kind: "terminal", terminalId: "t2" });
    const ws = useWorkspaceLayoutStore.getState().workspaces[`${SRV}:${WS}`]!;
    const pane = listPanes(ws.layout.root)[0]!;
    const before = [...pane.tabIds];
    if (before.length >= 2) {
      useWorkspaceLayoutStore.getState().reorderTab(SRV, WS, pane.id, 0, 1);
      const after = listPanes(
        useWorkspaceLayoutStore.getState().workspaces[`${SRV}:${WS}`]!.layout.root,
      )[0]!.tabIds;
      // First and second swapped
      expect(after[0]).toBe(before[1]);
      expect(after[1]).toBe(before[0]);
    }
  });
});

describe("WorkspaceLayoutStore — stale tabs", () => {
  beforeEach(reset);

  it("marks a tab as stale with reason", () => {
    useWorkspaceLayoutStore.getState().initWorkspace(SRV, WS, "agent1");
    const tabId = useWorkspaceLayoutStore.getState().openTab(SRV, WS, { kind: "terminal", terminalId: "t1" });
    useWorkspaceLayoutStore.getState().markStale(SRV, WS, tabId, "Terminal closed");
    const record = useWorkspaceLayoutStore.getState().workspaces[`${SRV}:${WS}`]!.tabs[tabId]!;
    expect(record.isStale).toBe(true);
    expect(record.staleReason).toBe("Terminal closed");
  });

  it("clears stale flag", () => {
    useWorkspaceLayoutStore.getState().initWorkspace(SRV, WS, "agent1");
    const tabId = useWorkspaceLayoutStore.getState().openTab(SRV, WS, { kind: "terminal", terminalId: "t1" });
    useWorkspaceLayoutStore.getState().markStale(SRV, WS, tabId, "reason");
    useWorkspaceLayoutStore.getState().clearStale(SRV, WS, tabId);
    expect(useWorkspaceLayoutStore.getState().workspaces[`${SRV}:${WS}`]!.tabs[tabId]?.isStale).toBe(false);
  });
});

describe("WorkspaceLayoutStore — activateTab / LRU", () => {
  beforeEach(reset);

  it("updates mountedLru on tab activation", () => {
    useWorkspaceLayoutStore.getState().initWorkspace(SRV, WS, "agent1");
    const t1 = useWorkspaceLayoutStore.getState().openTab(SRV, WS, { kind: "terminal", terminalId: "t1" });
    const t2 = useWorkspaceLayoutStore.getState().openTab(SRV, WS, { kind: "terminal", terminalId: "t2" });
    const t3 = useWorkspaceLayoutStore.getState().openTab(SRV, WS, { kind: "terminal", terminalId: "t3" });
    const t4 = useWorkspaceLayoutStore.getState().openTab(SRV, WS, { kind: "terminal", terminalId: "t4" });
    // Activate tabs in order to build up LRU
    useWorkspaceLayoutStore.getState().activateTab(SRV, WS, t1);
    useWorkspaceLayoutStore.getState().activateTab(SRV, WS, t2);
    useWorkspaceLayoutStore.getState().activateTab(SRV, WS, t3);
    useWorkspaceLayoutStore.getState().activateTab(SRV, WS, t4);
    const lru = useWorkspaceLayoutStore.getState().workspaces[`${SRV}:${WS}`]!.mountedLru;
    // LRU capped at 3, newest first
    expect(lru).toHaveLength(3);
    expect(lru[0]).toBe(t4);
  });

  it("brings re-activated tab to front of LRU", () => {
    useWorkspaceLayoutStore.getState().initWorkspace(SRV, WS, "agent1");
    const initTabId = Object.keys(useWorkspaceLayoutStore.getState().workspaces[`${SRV}:${WS}`]!.tabs)[0]!;
    const t1 = useWorkspaceLayoutStore.getState().openTab(SRV, WS, { kind: "terminal", terminalId: "lru1" });
    const t2 = useWorkspaceLayoutStore.getState().openTab(SRV, WS, { kind: "terminal", terminalId: "lru2" });
    useWorkspaceLayoutStore.getState().activateTab(SRV, WS, t1);
    useWorkspaceLayoutStore.getState().activateTab(SRV, WS, t2);
    useWorkspaceLayoutStore.getState().activateTab(SRV, WS, t1); // bring t1 back to front
    const lru = useWorkspaceLayoutStore.getState().workspaces[`${SRV}:${WS}`]!.mountedLru;
    expect(lru[0]).toBe(t1);
  });
});

describe("WorkspaceLayoutStore — splitTab", () => {
  beforeEach(reset);

  it("splits a tab to the right and creates a new pane", () => {
    useWorkspaceLayoutStore.getState().initWorkspace(SRV, WS, "agent1");
    const ws = useWorkspaceLayoutStore.getState().workspaces[`${SRV}:${WS}`]!;
    const pane = listPanes(ws.layout.root)[0]!;
    const tabId = pane.tabIds[0]!;
    useWorkspaceLayoutStore.getState().splitTab(SRV, WS, pane.id, tabId, "right");
    const newWs = useWorkspaceLayoutStore.getState().workspaces[`${SRV}:${WS}`]!;
    const panes = listPanes(newWs.layout.root);
    expect(panes.length).toBe(2);
  });
});
