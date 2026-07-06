/**
 * Navigation hooks tests — sprint-023 / task-004
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  useNavigationStore,
  NAV_QUERY_KEYS,
} from "./use-nav-hooks.js";

// Reset store state before each test
function resetNav() {
  useNavigationStore.setState({
    activeWorkspaceId: null,
    sidebarCollapsed: false,
    collapsedSections: { projects: false, schedules: true, recent: false },
    workspaceSortOrder: "recent",
    lastWorkspaceByHost: {},
  });
}

describe("NavigationStore", () => {
  beforeEach(resetNav);

  it("starts with default state", () => {
    const s = useNavigationStore.getState();
    expect(s.activeWorkspaceId).toBeNull();
    expect(s.sidebarCollapsed).toBe(false);
    expect(s.workspaceSortOrder).toBe("recent");
    expect(s.collapsedSections.schedules).toBe(true);
    expect(s.collapsedSections.projects).toBe(false);
  });

  it("setActiveWorkspace updates workspaceId", () => {
    useNavigationStore.getState().setActiveWorkspace("ws1");
    expect(useNavigationStore.getState().activeWorkspaceId).toBe("ws1");
  });

  it("setActiveWorkspace clears to null", () => {
    useNavigationStore.getState().setActiveWorkspace("ws1");
    useNavigationStore.getState().setActiveWorkspace(null);
    expect(useNavigationStore.getState().activeWorkspaceId).toBeNull();
  });

  it("setSidebarCollapsed toggles sidebar", () => {
    useNavigationStore.getState().setSidebarCollapsed(true);
    expect(useNavigationStore.getState().sidebarCollapsed).toBe(true);
    useNavigationStore.getState().setSidebarCollapsed(false);
    expect(useNavigationStore.getState().sidebarCollapsed).toBe(false);
  });

  it("toggleSection flips a section's collapsed state", () => {
    // projects starts false → toggle → true
    useNavigationStore.getState().toggleSection("projects");
    expect(useNavigationStore.getState().collapsedSections.projects).toBe(true);
    // toggle back
    useNavigationStore.getState().toggleSection("projects");
    expect(useNavigationStore.getState().collapsedSections.projects).toBe(false);
  });

  it("toggleSection does not affect other sections", () => {
    useNavigationStore.getState().toggleSection("projects");
    // schedules was true, should remain true
    expect(useNavigationStore.getState().collapsedSections.schedules).toBe(true);
  });

  it("setWorkspaceSortOrder updates sort order", () => {
    useNavigationStore.getState().setWorkspaceSortOrder("alpha");
    expect(useNavigationStore.getState().workspaceSortOrder).toBe("alpha");
  });

  it("setLastWorkspace records per-host last workspace", () => {
    useNavigationStore.getState().setLastWorkspace("srv1", "ws1");
    useNavigationStore.getState().setLastWorkspace("srv2", "ws2");
    const state = useNavigationStore.getState();
    expect(state.lastWorkspaceByHost["srv1"]).toBe("ws1");
    expect(state.lastWorkspaceByHost["srv2"]).toBe("ws2");
  });

  it("setLastWorkspace overwrites previous entry for same host", () => {
    useNavigationStore.getState().setLastWorkspace("srv1", "ws1");
    useNavigationStore.getState().setLastWorkspace("srv1", "ws2");
    expect(useNavigationStore.getState().lastWorkspaceByHost["srv1"]).toBe("ws2");
  });
});

describe("NAV_QUERY_KEYS", () => {
  it("generates schedules key", () => {
    expect(NAV_QUERY_KEYS.schedules("srv1")).toEqual(["schedules", "srv1"]);
  });

  it("generates scheduleLogs key", () => {
    expect(NAV_QUERY_KEYS.scheduleLogs("srv1", "sched1")).toEqual([
      "schedules",
      "logs",
      "srv1",
      "sched1",
    ]);
  });

  it("generates projects key", () => {
    expect(NAV_QUERY_KEYS.projects()).toEqual(["projects"]);
  });

  it("generates workspaces key", () => {
    expect(NAV_QUERY_KEYS.workspaces("srv1")).toEqual(["workspaces", "srv1"]);
  });
});
