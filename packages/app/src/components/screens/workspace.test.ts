/**
 * Tests for workspace screen scaffold & route gating (task-001).
 * Pure logic — no DOM/JSX.
 */

import { describe, it, expect } from "vitest";
import {
  resolveWorkspaceRouteGate,
  type WorkspaceRouteGateInput,
} from "../../workspace/route-gating.js";
import {
  composeWorkspaceScreen,
  type WorkspaceFormFactor,
} from "../../workspace/composition.js";
import {
  shouldSeedDraft,
  resolveWorkspaceEntry,
  type WorkspaceHydrationState,
} from "../../workspace/seeding.js";

// ---------------------------------------------------------------------------
// Route gating state machine
// ---------------------------------------------------------------------------
describe("resolveWorkspaceRouteGate", () => {
  const base: WorkspaceRouteGateInput = {
    routeServerId: "srv-1",
    activeServerId: "srv-1",
    workspaceId: "ws-1",
    hostOnline: true,
    workspacesHydrated: true,
    tabsHydrated: true,
    knownWorkspaceIds: ["ws-1"],
  };

  it("ready when all conditions met", () => {
    expect(resolveWorkspaceRouteGate(base).state).toBe("ready");
  });

  it("foreign when activeServerId differs", () => {
    const gate = resolveWorkspaceRouteGate({ ...base, activeServerId: "other" });
    expect(gate.state).toBe("foreign");
    if (gate.state === "foreign") expect(gate.redirect).toContain("other");
  });

  it("reconnecting when host offline + workspace known", () => {
    expect(resolveWorkspaceRouteGate({ ...base, hostOnline: false }).state).toBe("reconnecting");
  });

  it("unreachable when host offline + workspace unknown", () => {
    expect(resolveWorkspaceRouteGate({ ...base, hostOnline: false, knownWorkspaceIds: [] }).state).toBe("unreachable");
  });

  it("loading when workspaces not hydrated", () => {
    expect(resolveWorkspaceRouteGate({ ...base, workspacesHydrated: false }).state).toBe("loading");
  });

  it("missing when workspace not in known list", () => {
    expect(resolveWorkspaceRouteGate({ ...base, knownWorkspaceIds: [] }).state).toBe("missing");
  });

  it("directory-missing when workspaceDirExists=false", () => {
    expect(resolveWorkspaceRouteGate({ ...base, workspaceDirExists: false }).state).toBe("directory-missing");
  });

  it("splash when tabs not hydrated", () => {
    expect(resolveWorkspaceRouteGate({ ...base, tabsHydrated: false }).state).toBe("splash");
  });
});

// ---------------------------------------------------------------------------
// Workspace composition
// ---------------------------------------------------------------------------
describe("composeWorkspaceScreen", () => {
  it("wide + explorer open → shows sidebar", () => {
    const c = composeWorkspaceScreen({ focusMode: false, formFactor: "wide", platform: "web", explorerOpen: true, workspaceDirPresent: true, panes: [] });
    expect(c.showExplorerSidebar).toBe(true);
    expect(c.showPrimaryHeader).toBe(true);
  });

  it("focus mode hides header on non-mobile", () => {
    const c = composeWorkspaceScreen({ focusMode: true, formFactor: "wide", platform: "web", explorerOpen: false, workspaceDirPresent: true, panes: [] });
    expect(c.showPrimaryHeader).toBe(false);
  });

  it("mobile always shows header (even focus mode)", () => {
    const c = composeWorkspaceScreen({ focusMode: true, formFactor: "mobile", platform: "web", explorerOpen: false, workspaceDirPresent: true, panes: [] });
    expect(c.showPrimaryHeader).toBe(true);
  });

  it("tabStripMode: mobile → mobile-switcher; multi-pane web → per-pane", () => {
    const m = composeWorkspaceScreen({ focusMode: false, formFactor: "mobile", platform: "web", explorerOpen: false, workspaceDirPresent: true, panes: [] });
    expect(m.tabStripMode).toBe("mobile-switcher");

    const w = composeWorkspaceScreen({ focusMode: false, formFactor: "wide", platform: "web", explorerOpen: false, workspaceDirPresent: true, panes: [{} as any, {} as any] });
    expect(w.tabStripMode).toBe("per-pane");
  });
});

// ---------------------------------------------------------------------------
// Seeding
// ---------------------------------------------------------------------------
describe("shouldSeedDraft", () => {
  const base: WorkspaceHydrationState = {
    routeFocused: true,
    persistenceKey: "pk",
    workspaceDir: "/tmp/ws",
    layoutHydrated: true,
    agentsHydrated: true,
    terminalsHydrated: true,
    activeAgentCount: 0,
    terminalCount: 0,
    tabs: [],
  };

  it("true when all conditions met and no tabs/agents/terminals", () => {
    expect(shouldSeedDraft(base)).toBe(true);
  });

  it("false when tabs exist", () => {
    expect(shouldSeedDraft({ ...base, tabs: [{ tabId: "t1" } as any] })).toBe(false);
  });

  it("false when agents active", () => {
    expect(shouldSeedDraft({ ...base, activeAgentCount: 1 })).toBe(false);
  });

  it("false when not route-focused", () => {
    expect(shouldSeedDraft({ ...base, routeFocused: false })).toBe(false);
  });

  it("false when layout not hydrated", () => {
    expect(shouldSeedDraft({ ...base, layoutHydrated: false })).toBe(false);
  });
});

describe("resolveWorkspaceEntry", () => {
  const base: WorkspaceHydrationState = {
    routeFocused: true,
    persistenceKey: "pk",
    workspaceDir: "/tmp/ws",
    layoutHydrated: true,
    agentsHydrated: true,
    terminalsHydrated: true,
    activeAgentCount: 0,
    terminalCount: 0,
    tabs: [],
  };

  it("seeds draft when no intent and conditions met", () => {
    const result = resolveWorkspaceEntry({ state: base, openIntent: null, nextDraftId: "d1" });
    expect(result.action).toBe("seed-draft");
  });

  it("opens target from intent", () => {
    const result = resolveWorkspaceEntry({ state: base, openIntent: { kind: "agent", id: "a1" }, nextDraftId: "d1" });
    expect(result.action).toBe("open-target");
  });

  it("none when seeding conditions not met and no intent", () => {
    const result = resolveWorkspaceEntry({ state: { ...base, activeAgentCount: 1 }, openIntent: null, nextDraftId: "d1" });
    expect(result.action).toBe("none");
  });
});
