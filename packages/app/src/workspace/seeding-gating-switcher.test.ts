import { describe, expect, it } from "vitest";

import {
  buildMobileSwitcher,
  compactVisibleTabs,
  createMemoryLayoutStorage,
  createWorkspaceTab,
  DEFAULT_PINNED_TARGETS,
  migratePinnedTargets,
  pinnedMenuItem,
  pinnedTargetKey,
  PinnedTargetsStore,
  quickLaunchButtons,
  resolveWorkspaceEntry,
  resolveWorkspaceRouteGate,
  seedDraftTab,
  shouldSeedDraft,
  targetFromOpenIntent,
  togglePinnedTarget,
  type WorkspaceHydrationState,
} from "./index.js";

const readyEmpty: WorkspaceHydrationState = {
  routeFocused: true,
  persistenceKey: "s:w",
  workspaceDir: "/repo",
  layoutHydrated: true,
  agentsHydrated: true,
  terminalsHydrated: true,
  activeAgentCount: 0,
  terminalCount: 0,
  tabs: [],
};

describe("empty workspace seeding and open intent", () => {
  it("seeds a draft only after all readiness gates and genuine empty workspace", () => {
    expect(shouldSeedDraft(readyEmpty)).toBe(true);
    expect(seedDraftTab(readyEmpty, "draft-1", 1)).toMatchObject({ tabId: "draft-1", target: { kind: "draft", draftId: "draft-1", setup: { cwd: "/repo" } } });
    expect(shouldSeedDraft({ ...readyEmpty, tabs: [createWorkspaceTab({ kind: "agent", agentId: "a" })] })).toBe(false);
    expect(shouldSeedDraft({ ...readyEmpty, agentsHydrated: false })).toBe(false);
    expect(shouldSeedDraft({ ...readyEmpty, terminalCount: 1 })).toBe(false);
  });

  it("maps ?open= intents to tab targets", () => {
    expect(targetFromOpenIntent({ kind: "agent", id: "a" })).toEqual({ kind: "agent", agentId: "a" });
    expect(targetFromOpenIntent({ kind: "terminal", id: "t" })).toEqual({ kind: "terminal", terminalId: "t" });
    expect(targetFromOpenIntent({ kind: "file", path: "/repo/a.ts" })).toEqual({ kind: "file", path: "/repo/a.ts" });
    expect(targetFromOpenIntent({ kind: "draft", id: "d" })).toEqual({ kind: "draft", draftId: "d" });
    expect(targetFromOpenIntent({ kind: "setup", workspaceId: "w" })).toEqual({ kind: "setup", workspaceId: "w" });
  });

  it("entry resolution prefers open intent focus/open before empty seed", () => {
    const existing = createWorkspaceTab({ kind: "agent", agentId: "a" });
    expect(resolveWorkspaceEntry({ state: { ...readyEmpty, tabs: [existing] }, openIntent: { kind: "agent", id: "a" }, nextDraftId: "d" })).toEqual({ action: "focus-existing", tabId: "agent_a" });
    expect(resolveWorkspaceEntry({ state: readyEmpty, openIntent: { kind: "terminal", id: "t" }, nextDraftId: "d" })).toEqual({ action: "open-target", target: { kind: "terminal", terminalId: "t" } });
    expect(resolveWorkspaceEntry({ state: readyEmpty, openIntent: null, nextDraftId: "d", now: 1 })).toMatchObject({ action: "seed-draft", tab: { tabId: "d" } });
  });
});

describe("pinned quick-launch targets", () => {
  it("defaults to terminal + browser and keys profile targets", () => {
    expect(DEFAULT_PINNED_TARGETS.map(pinnedTargetKey)).toEqual(["terminal", "browser"]);
    expect(pinnedTargetKey({ kind: "profile", profileId: "p1" })).toBe("profile:p1");
  });

  it("migrates legacy/empty shapes and backfills defaults", () => {
    expect(migratePinnedTargets(null).targets.map(pinnedTargetKey)).toEqual(["terminal", "browser"]);
    expect(migratePinnedTargets([{ kind: "draft" }]).targets.map(pinnedTargetKey)).toEqual(["terminal", "browser", "draft"]);
    expect(migratePinnedTargets({ version: 1, targets: [{ kind: "profile", profileId: "p" }] }).targets.map(pinnedTargetKey)).toEqual(["terminal", "browser", "profile:p"]);
  });

  it("toggles target membership and emits Pin/Unpin menu labels", () => {
    let targets = togglePinnedTarget(DEFAULT_PINNED_TARGETS, { kind: "draft" });
    expect(targets.map(pinnedTargetKey)).toEqual(["terminal", "browser", "draft"]);
    expect(pinnedMenuItem(targets, { kind: "draft" }).label).toBe("Unpin");
    targets = togglePinnedTarget(targets, { kind: "draft" });
    expect(targets.map(pinnedTargetKey)).toEqual(["terminal", "browser"]);
    expect(pinnedMenuItem(targets, { kind: "draft" }).label).toBe("Pin");
  });

  it("persists pinned set across reloads", () => {
    const storage = createMemoryLayoutStorage();
    const store = new PinnedTargetsStore(storage);
    expect(store.load().targets.map(pinnedTargetKey)).toEqual(["terminal", "browser"]);
    store.toggle({ kind: "draft" });
    expect(new PinnedTargetsStore(storage).load().targets.map(pinnedTargetKey)).toEqual(["terminal", "browser", "draft"]);
  });

  it("quick launch buttons open corresponding tab kind including profiles", () => {
    const buttons = quickLaunchButtons([{ kind: "terminal" }, { kind: "browser" }, { kind: "draft" }, { kind: "profile", profileId: "fast" }], {
      nextDraftId: "d",
      nextTerminalId: "t",
      nextBrowserId: "b",
      profileCwd: "/repo",
    });
    expect(buttons.map((b) => b.tabTarget.kind)).toEqual(["terminal", "browser", "draft", "draft"]);
    expect(buttons[3]?.tabTarget).toMatchObject({ kind: "draft", setup: { provider: "fast", cwd: "/repo" } });
  });
});

describe("route gating", () => {
  it("returns ready only for active host, known workspace, hydrated tabs", () => {
    expect(resolveWorkspaceRouteGate({ routeServerId: "s", activeServerId: "s", workspaceId: "w", hostOnline: true, workspacesHydrated: true, tabsHydrated: true, knownWorkspaceIds: ["w"], workspaceDirExists: true })).toEqual({ state: "ready" });
  });

  it("redirects foreign host and shows splash until tabs hydrate", () => {
    expect(resolveWorkspaceRouteGate({ routeServerId: "s1", activeServerId: "s2", workspaceId: "w", hostOnline: true, workspacesHydrated: true, tabsHydrated: true, knownWorkspaceIds: ["w"] })).toEqual({ state: "foreign", redirect: "/h/s2" });
    expect(resolveWorkspaceRouteGate({ routeServerId: "s", activeServerId: "s", workspaceId: "w", hostOnline: true, workspacesHydrated: true, tabsHydrated: false, knownWorkspaceIds: ["w"] })).toEqual({ state: "splash" });
  });

  it("handles reconnecting, unreachable, loading, missing, and directory-missing gates", () => {
    expect(resolveWorkspaceRouteGate({ routeServerId: "s", workspaceId: "w", hostOnline: false, workspacesHydrated: false, tabsHydrated: false, knownWorkspaceIds: ["w"] }).state).toBe("reconnecting");
    expect(resolveWorkspaceRouteGate({ routeServerId: "s", workspaceId: "w", hostOnline: false, workspacesHydrated: false, tabsHydrated: false, knownWorkspaceIds: [] }).state).toBe("unreachable");
    expect(resolveWorkspaceRouteGate({ routeServerId: "s", workspaceId: "w", hostOnline: true, workspacesHydrated: false, tabsHydrated: false, knownWorkspaceIds: [] }).state).toBe("loading");
    expect(resolveWorkspaceRouteGate({ routeServerId: "s", workspaceId: "w", hostOnline: true, workspacesHydrated: true, tabsHydrated: false, knownWorkspaceIds: [] }).state).toBe("missing");
    expect(resolveWorkspaceRouteGate({ routeServerId: "s", workspaceId: "w", hostOnline: true, workspacesHydrated: true, tabsHydrated: true, knownWorkspaceIds: ["w"], workspaceDirExists: false }).state).toBe("directory-missing");
  });
});

describe("mobile tab switcher", () => {
  it("shows exactly one visible tab on compact and no split UI", () => {
    const tabs = [createWorkspaceTab({ kind: "agent", agentId: "a" }), createWorkspaceTab({ kind: "terminal", terminalId: "t" })];
    expect(compactVisibleTabs(tabs, "terminal_t").map((t) => t.tabId)).toEqual(["terminal_t"]);
    const model = buildMobileSwitcher({ tabs, activeTabId: "terminal_t", pinnedTargets: [{ kind: "terminal" }], nextDraftId: "d", nextTerminalId: "new-t", nextBrowserId: "b" });
    expect(model.visibleTabId).toBe("terminal_t");
    expect(model.entries.map((e) => [e.tabId, e.active])).toEqual([["agent_a", false], ["terminal_t", true]]);
    expect(model.newTabActions.map((a) => a.key)).toEqual(["terminal"]);
    expect(model.splitsVisible).toBe(false);
  });
});
