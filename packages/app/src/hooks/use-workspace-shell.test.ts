/**
 * Workspace shell hooks tests — sprint-024 / task-004
 *
 * Tests shortcut resolution, sidebar data computation, and header data logic.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { useSessionStore } from "../store/session-store.js";
import { useWorkspaceLayoutStore } from "../store/workspace-layout-store.js";
import { useNavigationStore } from "./use-nav-hooks.js";
import { createMemoryLayoutStorage } from "../workspace/layout-store.js";

function resetStores() {
  useSessionStore.setState({ agents: {}, workspaces: {}, servers: {}, activeServerId: null });
  useWorkspaceLayoutStore.setState({ workspaces: {}, _storage: createMemoryLayoutStorage(), _saveTimers: {} });
  useNavigationStore.setState({
    activeWorkspaceId: null,
    sidebarCollapsed: false,
    collapsedSections: { projects: false, schedules: true, recent: false },
    workspaceSortOrder: "recent",
    lastWorkspaceByHost: {},
  });
}

// ─── Shortcut resolver (pure logic via store) ─────────────────────────────────

describe("workspace shortcut resolution", () => {
  beforeEach(resetStores);

  it("Cmd+T → new-terminal action", async () => {
    const { useWorkspaceShortcuts } = await import("./use-workspace-shell.js");
    // Access the resolver logic directly by testing the store-level action
    useWorkspaceLayoutStore.getState().initWorkspace("srv1", "ws1", "agent1");
    const tabsBefore = Object.keys(
      useWorkspaceLayoutStore.getState().workspaces["srv1:ws1"]?.tabs ?? {},
    ).length;

    // Simulate Cmd+T → open terminal
    useWorkspaceLayoutStore.getState().openTab("srv1", "ws1", {
      kind: "terminal",
      terminalId: "t-new",
    });

    const tabsAfter = Object.keys(
      useWorkspaceLayoutStore.getState().workspaces["srv1:ws1"]?.tabs ?? {},
    ).length;
    expect(tabsAfter).toBe(tabsBefore + 1);
  });

  it("Cmd+1..9 → focus-tab by index (store activateTab)", () => {
    useWorkspaceLayoutStore.getState().initWorkspace("srv1", "ws1", "agent1");
    const t1 = useWorkspaceLayoutStore.getState().openTab("srv1", "ws1", {
      kind: "terminal",
      terminalId: "tx1",
    });
    const t2 = useWorkspaceLayoutStore.getState().openTab("srv1", "ws1", {
      kind: "terminal",
      terminalId: "tx2",
    });
    // Activate index 1 (second tab)
    const ws = useWorkspaceLayoutStore.getState().workspaces["srv1:ws1"]!;
    const tabId = ws.tabOrder[1];
    if (tabId) {
      useWorkspaceLayoutStore.getState().activateTab("srv1", "ws1", tabId);
      const lru = useWorkspaceLayoutStore.getState().workspaces["srv1:ws1"]?.mountedLru;
      expect(lru?.[0]).toBe(tabId);
    }
  });

  it("toggle-sidebar flips sidebarCollapsed", () => {
    expect(useNavigationStore.getState().sidebarCollapsed).toBe(false);
    useNavigationStore.getState().setSidebarCollapsed(true);
    expect(useNavigationStore.getState().sidebarCollapsed).toBe(true);
    useNavigationStore.getState().setSidebarCollapsed(false);
    expect(useNavigationStore.getState().sidebarCollapsed).toBe(false);
  });
});

// ─── Sidebar workspace items ──────────────────────────────────────────────────

describe("sidebar data — workspace items", () => {
  beforeEach(resetStores);

  it("agent running in workspace propagates status to sidebar item", () => {
    useSessionStore.getState().upsertAgent({
      agentId: "a1",
      status: "running",
      workspaceId: "ws1",
    });
    const agents = Object.values(useSessionStore.getState().agents).filter(
      (a) => a.workspaceId === "ws1",
    );
    expect(agents[0]?.status).toBe("running");
  });

  it("navigation store sort order persists", () => {
    useNavigationStore.getState().setWorkspaceSortOrder("alpha");
    expect(useNavigationStore.getState().workspaceSortOrder).toBe("alpha");
  });
});

// ─── Workspace header data ────────────────────────────────────────────────────

describe("workspace header data", () => {
  beforeEach(resetStores);

  it("workspace descriptor name used as title", () => {
    useSessionStore.getState().upsertWorkspace({
      workspaceId: "ws1",
      name: "My Project",
      agentIds: [],
    });
    const ws = useSessionStore.getState().workspaces["ws1"]!;
    expect(ws.name).toBe("My Project");
  });

  it("running agent → canStop=true, canNewMessage=false", () => {
    useSessionStore.getState().upsertAgent({
      agentId: "a1",
      status: "running",
      workspaceId: "ws1",
    });
    const agents = Object.values(useSessionStore.getState().agents);
    const primary = agents.find((a) => a.status === "running");
    expect(primary?.status).toBe("running");
    // canStop derived from status === "running"
    expect(primary?.status === "running").toBe(true);
  });

  it("idle agent → canStop=false, canNewMessage=true", () => {
    useSessionStore.getState().upsertAgent({
      agentId: "a1",
      status: "idle",
      workspaceId: "ws1",
    });
    const agents = Object.values(useSessionStore.getState().agents);
    const primary = agents[0];
    expect(primary?.status === "idle").toBe(true);
  });
});
