// Workspace tab model and operations.
// clean-room-scope/features/workspace-ui.md § Tab model, § Tab operations

import type { WorkspaceOpenIntent } from "../runtime/route-grammar.js";

export type DraftSetup = {
  provider: string;
  cwd: string;
  modeId?: string;
  model?: string;
  thinkingOptionId?: string;
  featureValues?: Record<string, unknown>;
};

export type DraftTarget = { kind: "draft"; draftId: string; setup?: DraftSetup };
export type AgentTarget = { kind: "agent"; agentId: string };
export type TerminalTarget = { kind: "terminal"; terminalId: string };
export type BrowserTarget = { kind: "browser"; browserId: string };
export type FileTarget = { kind: "file"; path: string; lineStart?: number; lineEnd?: number };
export type SetupTarget = { kind: "setup"; workspaceId: string };

export type WorkspaceTabTarget = DraftTarget | AgentTarget | TerminalTarget | BrowserTarget | FileTarget | SetupTarget;
export type WorkspaceTabKind = WorkspaceTabTarget["kind"];

export type WorkspaceTab = {
  tabId: string;
  target: WorkspaceTabTarget;
  createdAt: number;
  parentTabId?: string;
};

export type WorkspaceTabDescriptor = {
  key: string;
  tabId: string;
  kind: WorkspaceTabKind;
  target: WorkspaceTabTarget;
};

/**
 * Map a `?open=` workspace intent to the tab target that should be opened.
 * Used by LiveWorkspacePage to honour deep-link / navigation intents
 * (`agent:<id>`, `terminal:<id>`, `browser:<id>`, `file:<base64path>`, `draft:<id>`, `setup:`).
 */
export function openIntentToTabTarget(intent: WorkspaceOpenIntent): WorkspaceTabTarget {
  switch (intent.kind) {
    case "agent":
      return { kind: "agent", agentId: intent.id };
    case "terminal":
      return { kind: "terminal", terminalId: intent.id };
    case "browser":
      return { kind: "browser", browserId: intent.id };
    case "file":
      return { kind: "file", path: intent.path };
    case "draft":
      return { kind: "draft", draftId: intent.id };
    case "setup":
      return { kind: "setup", workspaceId: intent.workspaceId };
  }
}

export function tabIdForTarget(target: WorkspaceTabTarget): string {
  switch (target.kind) {
    case "draft":
      return target.draftId;
    case "agent":
      return `agent_${target.agentId}`;
    case "terminal":
      return `terminal_${target.terminalId}`;
    case "browser":
      return `browser_${target.browserId}`;
    case "file":
      return `file_${target.path}`;
    case "setup":
      return `setup_${target.workspaceId}`;
  }
}

export function targetKey(target: WorkspaceTabTarget): string {
  switch (target.kind) {
    case "draft":
      return `draft:${target.draftId}:${stableJson(target.setup ?? null)}`;
    case "agent":
      return `agent:${target.agentId}`;
    case "terminal":
      return `terminal:${target.terminalId}`;
    case "browser":
      return `browser:${target.browserId}`;
    case "file":
      return `file:${target.path}`;
    case "setup":
      return `setup:${target.workspaceId}`;
  }
}

export function targetsEqual(a: WorkspaceTabTarget, b: WorkspaceTabTarget): boolean {
  return targetKey(a) === targetKey(b);
}

export function describeTab(tab: WorkspaceTab): WorkspaceTabDescriptor {
  return { key: targetKey(tab.target), tabId: tab.tabId, kind: tab.target.kind, target: tab.target };
}

export function createWorkspaceTab(target: WorkspaceTabTarget, createdAt = Date.now(), parentTabId?: string): WorkspaceTab {
  return { tabId: tabIdForTarget(target), target, createdAt, parentTabId };
}

export type OpenTabResult = {
  tabs: WorkspaceTab[];
  focusedTabId: string;
  reopened: boolean;
};

export function openWorkspaceTab(
  tabs: readonly WorkspaceTab[],
  target: WorkspaceTabTarget,
  input: { focus?: boolean; createdAt?: number; parentTabId?: string } = {},
): OpenTabResult {
  const existing = tabs.find((tab) => targetsEqual(tab.target, target) || tab.tabId === tabIdForTarget(target));
  if (existing) {
    return { tabs: [...tabs], focusedTabId: existing.tabId, reopened: true };
  }
  const next = createWorkspaceTab(target, input.createdAt, input.parentTabId);
  return { tabs: [...tabs, next], focusedTabId: input.focus === false && tabs[0] ? tabs[0].tabId : next.tabId, reopened: false };
}

export function retargetWorkspaceTab(
  tabs: readonly WorkspaceTab[],
  tabId: string,
  target: WorkspaceTabTarget,
): { tabs: WorkspaceTab[]; oldTabId: string; newTabId: string } {
  const newTabId = tabIdForTarget(target);
  return {
    oldTabId: tabId,
    newTabId,
    tabs: tabs.map((tab) => tab.tabId === tabId ? { ...tab, tabId: newTabId, target } : tab),
  };
}

export function dedupeWorkspaceTabs(tabs: readonly WorkspaceTab[]): WorkspaceTab[] {
  const seen = new Set<string>();
  const result: WorkspaceTab[] = [];
  for (const tab of tabs) {
    const key = targetKey(tab.target);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(tab);
  }
  return result;
}

export function defaultTabLabel(target: WorkspaceTabTarget): string {
  switch (target.kind) {
    case "draft":
      return "New Agent";
    case "agent":
      return "Agent";
    case "terminal":
      return "Terminal";
    case "browser":
      return "Browser";
    case "file":
      return filename(target.path);
    case "setup":
      return "Setup";
  }
}

function filename(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const parts = normalized.split("/").filter(Boolean);
  return parts.at(-1) ?? path;
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((k) => `${JSON.stringify(k)}:${stableJson(record[k])}`).join(",")}}`;
}
