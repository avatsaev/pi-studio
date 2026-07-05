// Workspace tab reconciliation against backend snapshots.
// clean-room-scope/features/workspace-ui.md § Reconciliation

import { createWorkspaceTab, tabIdForTarget, targetKey, type WorkspaceTab, type WorkspaceTabTarget } from "./tabs.js";

export type AgentSnapshotForTabs = {
  agentId: string;
  cwd?: string;
  archivedAt?: string;
  parentAgentId?: string;
};

export type TabReconciliationSnapshot = {
  workspaceCwd: string;
  agentsHydrated: boolean;
  terminalsHydrated: boolean;
  agents: readonly AgentSnapshotForTabs[];
  knownTerminalIds: readonly string[];
  standaloneTerminalIds: readonly string[];
  autoOpenAgentIds: readonly string[];
  pins?: readonly string[];
  hides?: readonly string[];
  now?: number;
};

export type TabReconciliationResult = {
  tabs: WorkspaceTab[];
  prunedTabIds: string[];
  addedTabIds: string[];
};

export function reconcileWorkspaceTabs(
  currentTabs: readonly WorkspaceTab[],
  snapshot: TabReconciliationSnapshot,
): TabReconciliationResult {
  const pins = new Set(snapshot.pins ?? []);
  const hides = new Set(snapshot.hides ?? []);
  const knownTerminals = new Set(snapshot.knownTerminalIds);
  const visibleAgentIds = new Set(
    snapshot.agents
      .filter((agent) => !agent.archivedAt && sameCwd(agent.cwd, snapshot.workspaceCwd))
      .map((agent) => agent.agentId),
  );
  const knownAgentIds = new Set(snapshot.agents.map((agent) => agent.agentId));

  const prunedTabIds: string[] = [];
  let tabs = dedupeByCanonicalTarget(currentTabs).filter((tab) => {
    const key = targetKey(tab.target);
    if (pins.has(key)) return true;
    if (hides.has(key)) {
      prunedTabIds.push(tab.tabId);
      return false;
    }
    if (tab.target.kind === "agent" && snapshot.agentsHydrated) {
      const keep = visibleAgentIds.has(tab.target.agentId) && knownAgentIds.has(tab.target.agentId);
      if (!keep) prunedTabIds.push(tab.tabId);
      return keep;
    }
    if (tab.target.kind === "terminal" && snapshot.terminalsHydrated) {
      const keep = knownTerminals.has(tab.target.terminalId);
      if (!keep) prunedTabIds.push(tab.tabId);
      return keep;
    }
    return true;
  });

  const addedTabIds: string[] = [];
  const addIfMissing = (target: WorkspaceTabTarget) => {
    const key = targetKey(target);
    if (hides.has(key) && !pins.has(key)) return;
    if (tabs.some((tab) => targetKey(tab.target) === key)) return;
    const tab = createWorkspaceTab(target, snapshot.now ?? Date.now());
    tabs = [...tabs, tab];
    addedTabIds.push(tab.tabId);
  };

  for (const agentId of snapshot.autoOpenAgentIds) {
    if (visibleAgentIds.has(agentId) || pins.has(`agent:${agentId}`)) addIfMissing({ kind: "agent", agentId });
  }
  for (const terminalId of snapshot.standaloneTerminalIds) {
    if (knownTerminals.has(terminalId) || pins.has(`terminal:${terminalId}`)) addIfMissing({ kind: "terminal", terminalId });
  }

  for (const key of pins) {
    const target = targetFromKey(key);
    if (target) addIfMissing(target);
  }

  return { tabs, prunedTabIds, addedTabIds };
}

function dedupeByCanonicalTarget(tabs: readonly WorkspaceTab[]): WorkspaceTab[] {
  const seen = new Set<string>();
  const result: WorkspaceTab[] = [];
  for (const tab of tabs) {
    const key = targetKey(tab.target);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ ...tab, tabId: tab.tabId || tabIdForTarget(tab.target) });
  }
  return result;
}

export function sameCwd(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false;
  return normalizeCwd(a) === normalizeCwd(b);
}

export function normalizeCwd(cwd: string): string {
  return cwd.replace(/\\/g, "/").replace(/\/+/g, "/").replace(/\/$/, "").toLowerCase();
}

function targetFromKey(key: string): WorkspaceTabTarget | null {
  if (key.startsWith("agent:")) return { kind: "agent", agentId: key.slice("agent:".length) };
  if (key.startsWith("terminal:")) return { kind: "terminal", terminalId: key.slice("terminal:".length) };
  if (key.startsWith("browser:")) return { kind: "browser", browserId: key.slice("browser:".length) };
  if (key.startsWith("setup:")) return { kind: "setup", workspaceId: key.slice("setup:".length) };
  if (key.startsWith("file:")) return { kind: "file", path: key.slice("file:".length) };
  return null;
}
