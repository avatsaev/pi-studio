import { describe, expect, it } from "vitest";

import {
  closeAgentTabDecision,
  createWorkspaceTab,
  descriptorForTab,
  openWorkspaceTab,
  reconcileWorkspaceTabs,
  registryEntryForDescriptor,
  rootWorkspaceBucketFromSubagents,
  subagentsForParent,
  targetKey,
  targetsEqual,
  describeTab,
  retargetWorkspaceTab,
  archiveSubagentAction,
  type WorkspaceTab,
} from "./index.js";

describe("workspace tab model", () => {
  it("uses deterministic ids for all tab target kinds", () => {
    expect(createWorkspaceTab({ kind: "draft", draftId: "d1" }).tabId).toBe("d1");
    expect(createWorkspaceTab({ kind: "agent", agentId: "a1" }).tabId).toBe("agent_a1");
    expect(createWorkspaceTab({ kind: "terminal", terminalId: "t1" }).tabId).toBe("terminal_t1");
    expect(createWorkspaceTab({ kind: "browser", browserId: "b1" }).tabId).toBe("browser_b1");
    expect(createWorkspaceTab({ kind: "file", path: "/repo/src/app.ts" }).tabId).toBe("file_/repo/src/app.ts");
    expect(createWorkspaceTab({ kind: "setup", workspaceId: "w1" }).tabId).toBe("setup_w1");
  });

  it("draft setup participates in target equality with stable object ordering", () => {
    const a = { kind: "draft" as const, draftId: "d1", setup: { provider: "pi", cwd: "/repo", featureValues: { b: 2, a: 1 } } };
    const b = { kind: "draft" as const, draftId: "d1", setup: { provider: "pi", cwd: "/repo", featureValues: { a: 1, b: 2 } } };
    const c = { kind: "draft" as const, draftId: "d1", setup: { provider: "pi", cwd: "/other" } };
    expect(targetsEqual(a, b)).toBe(true);
    expect(targetsEqual(a, c)).toBe(false);
  });

  it("reopening an existing target refocuses instead of duplicating", () => {
    const first = openWorkspaceTab([], { kind: "agent", agentId: "a1" }, { createdAt: 1 });
    const second = openWorkspaceTab(first.tabs, { kind: "agent", agentId: "a1" }, { createdAt: 2 });
    expect(second.reopened).toBe(true);
    expect(second.focusedTabId).toBe("agent_a1");
    expect(second.tabs).toHaveLength(1);
    expect(second.tabs[0]?.createdAt).toBe(1);
  });

  it("retargets a draft tab into an agent tab in place", () => {
    const draft = createWorkspaceTab({ kind: "draft", draftId: "draft-1" }, 1);
    const terminal = createWorkspaceTab({ kind: "terminal", terminalId: "t1" }, 2);
    const result = retargetWorkspaceTab([draft, terminal], "draft-1", { kind: "agent", agentId: "a1" });
    expect(result.oldTabId).toBe("draft-1");
    expect(result.newTabId).toBe("agent_a1");
    expect(result.tabs.map((t) => t.tabId)).toEqual(["agent_a1", "terminal_t1"]);
    expect(result.tabs[0]?.createdAt).toBe(1);
  });

  it("registry maps descriptors to component metadata and skeleton titles", () => {
    const tab = createWorkspaceTab({ kind: "agent", agentId: "a1" });
    const descriptor = describeTab(tab);
    expect(registryEntryForDescriptor(descriptor).component).toBe("AgentConversationPanel");
    expect(descriptorForTab(tab, { loading: true })).toMatchObject({ titleState: "skeleton", label: "", icon: "bot" });
    expect(descriptorForTab(createWorkspaceTab({ kind: "file", path: "/tmp/readme.md" })).label).toBe("readme.md");
  });
});

describe("workspace tab reconciliation", () => {
  const snapshotBase = {
    workspaceCwd: "/repo",
    agentsHydrated: true,
    terminalsHydrated: true,
    agents: [
      { agentId: "a1", cwd: "/repo" },
      { agentId: "archived", cwd: "/repo", archivedAt: "2026-01-01T00:00:00Z" },
      { agentId: "foreign", cwd: "/elsewhere" },
    ],
    knownTerminalIds: ["t1", "standalone"],
    standaloneTerminalIds: ["standalone"],
    autoOpenAgentIds: ["a1"],
    now: 5,
  };

  it("dedupes, prunes stale/archived after hydration, and auto-opens agents/standalone terminals", () => {
    const tabs: WorkspaceTab[] = [
      createWorkspaceTab({ kind: "agent", agentId: "a1" }, 1),
      createWorkspaceTab({ kind: "agent", agentId: "a1" }, 2),
      createWorkspaceTab({ kind: "agent", agentId: "archived" }, 3),
      createWorkspaceTab({ kind: "terminal", terminalId: "stale" }, 4),
    ];
    const result = reconcileWorkspaceTabs(tabs, snapshotBase);
    expect(result.tabs.map((tab) => tab.tabId)).toEqual(["agent_a1", "terminal_standalone"]);
    expect(result.prunedTabIds).toEqual(["agent_archived", "terminal_stale"]);
    expect(result.addedTabIds).toEqual(["terminal_standalone"]);
  });

  it("does not prune unknown backend tabs until the relevant snapshot hydrates", () => {
    const result = reconcileWorkspaceTabs([
      createWorkspaceTab({ kind: "agent", agentId: "unknown" }),
      createWorkspaceTab({ kind: "terminal", terminalId: "unknown" }),
    ], { ...snapshotBase, agentsHydrated: false, terminalsHydrated: false });
    expect(result.tabs.map((tab) => tab.tabId)).toContain("agent_unknown");
    expect(result.tabs.map((tab) => tab.tabId)).toContain("terminal_unknown");
  });

  it("pin forces visible while hide suppresses per-client", () => {
    const result = reconcileWorkspaceTabs([
      createWorkspaceTab({ kind: "agent", agentId: "a1" }),
      createWorkspaceTab({ kind: "terminal", terminalId: "t1" }),
    ], {
      ...snapshotBase,
      pins: ["agent:archived"],
      hides: [targetKey({ kind: "agent", agentId: "a1" }), targetKey({ kind: "terminal", terminalId: "standalone" })],
    });
    expect(result.tabs.map((tab) => tab.tabId)).toEqual(["terminal_t1", "agent_archived"]);
  });
});

describe("subagents policy", () => {
  it("track includes exactly non-archived children of the parent", () => {
    const agents = [
      { agentId: "child", parentAgentId: "root" },
      { agentId: "archived-child", parentAgentId: "root", archivedAt: "now" },
      { agentId: "detached" },
    ];
    expect(subagentsForParent(agents, "root").map((a) => a.agentId)).toEqual(["child"]);
  });

  it("closing root agent archives globally but closing subagent tab is layout-only", () => {
    expect(closeAgentTabDecision({ agentId: "root" })).toEqual({ action: "archive-agent", archive: true, reason: "root-agent" });
    expect(closeAgentTabDecision({ agentId: "child", parentAgentId: "root" })).toEqual({
      action: "layout-close",
      archive: false,
      reason: "subagent",
    });
  });

  it("subagent row archive is explicit and running child escalates root workspace bucket", () => {
    expect(archiveSubagentAction({ agentId: "child", parentAgentId: "root" })).toEqual({ action: "archive-agent", agentId: "child" });
    expect(rootWorkspaceBucketFromSubagents({ agentId: "root" }, [{ agentId: "child", parentAgentId: "root", status: "running" }])).toBe("running");
    expect(rootWorkspaceBucketFromSubagents({ agentId: "root" }, [{ agentId: "child", parentAgentId: "root", status: "waiting" }])).toBe("idle");
  });
});
