// Tab context-action logic: resume/copy payloads, close-to-side targeting,
// and persisted per-workspace tab labels (rename).
//
// clean-room-scope/features/workspace-ui.md § Tab operations, § tab context menu
// clean-room-scope/features/agent-sessions.md § resume / agent id
// clean-room-scope/sprints/sprint-030-integration-gap-closure/task-003

import type { LayoutStorage } from "./layout-store.js";
import type { WorkspaceTab } from "./tabs.js";

/** The shell command that re-attaches to (resumes streaming) an agent. */
export function resumeCommandFor(agentId: string): string {
  return `pi-studio agent attach ${agentId}`;
}

/** The agent id addressed by a tab, if it is an agent tab. */
export function agentIdForTab(tab: WorkspaceTab): string | undefined {
  return tab.target.kind === "agent" ? tab.target.agentId : undefined;
}

export interface ClipboardAction {
  /** Text placed on the clipboard. */
  text: string;
  /** Toast label shown after a successful copy. */
  toast: string;
}

/**
 * Resolve the clipboard payload for a copy-style context action, or null if the
 * action does not copy anything.
 */
export function clipboardPayloadFor(actionId: string, ctx: { agentId?: string }): ClipboardAction | null {
  if (!ctx.agentId) return null;
  switch (actionId) {
    case "copy-resume":
      return { text: resumeCommandFor(ctx.agentId), toast: "Resume command copied" };
    case "copy-agent-id":
      return { text: ctx.agentId, toast: "Agent id copied" };
    default:
      return null;
  }
}

/**
 * Tab ids to close for a close-to-side / close-others action, given the ordered
 * tab list and the target tab id. Returns [] for unknown actions.
 */
export function tabIdsToClose(actionId: string, tabOrder: readonly string[], targetTabId: string): string[] {
  const index = tabOrder.indexOf(targetTabId);
  if (index < 0) return [];
  switch (actionId) {
    case "close":
      return [targetTabId];
    case "close-others":
      return tabOrder.filter((id) => id !== targetTabId);
    case "close-left":
    case "close-above":
      return tabOrder.slice(0, index);
    case "close-right":
    case "close-below":
      return tabOrder.slice(index + 1);
    default:
      return [];
  }
}

// ─── Persisted tab labels (rename) ────────────────────────────────────────────

export type TabLabelsState = { version: 1; labels: Record<string, string> };

export function tabLabelsKey(serverId: string, workspaceId: string): string {
  return `tab-labels:${serverId}:${workspaceId}`;
}

function emptyLabels(): TabLabelsState {
  return { version: 1, labels: {} };
}

export function migrateTabLabels(value: unknown): TabLabelsState {
  if (
    typeof value === "object" &&
    value !== null &&
    (value as { version?: unknown }).version === 1 &&
    typeof (value as { labels?: unknown }).labels === "object" &&
    (value as { labels?: unknown }).labels !== null
  ) {
    const raw = (value as { labels: Record<string, unknown> }).labels;
    const labels: Record<string, string> = {};
    for (const [k, v] of Object.entries(raw)) {
      if (typeof v === "string" && v.length > 0) labels[k] = v;
    }
    return { version: 1, labels };
  }
  return emptyLabels();
}

/** Apply persisted labels onto tabs, producing `{ ...tab, label }` entries. */
export function mergeTabLabels<T extends WorkspaceTab>(
  tabs: readonly T[],
  labels: Record<string, string>,
): (T & { label?: string })[] {
  return tabs.map((tab) => {
    const label = labels[tab.tabId];
    return label ? { ...tab, label } : { ...tab };
  });
}

/** Per-workspace persisted tab-label store (mirrors PinnedTargetsStore). */
export class TabLabelsStore {
  constructor(private readonly storage: LayoutStorage) {}

  load(serverId: string, workspaceId: string): TabLabelsState {
    const raw = this.storage.getItem(tabLabelsKey(serverId, workspaceId));
    if (!raw) return emptyLabels();
    try {
      return migrateTabLabels(JSON.parse(raw));
    } catch {
      return emptyLabels();
    }
  }

  save(serverId: string, workspaceId: string, state: TabLabelsState): void {
    this.storage.setItem(tabLabelsKey(serverId, workspaceId), JSON.stringify(migrateTabLabels(state)));
  }

  /** Set or clear (empty label) a tab's custom label; returns the new state. */
  rename(serverId: string, workspaceId: string, tabId: string, label: string): TabLabelsState {
    const current = this.load(serverId, workspaceId);
    const labels = { ...current.labels };
    const trimmed = label.trim();
    if (trimmed) labels[tabId] = trimmed;
    else delete labels[tabId];
    const next: TabLabelsState = { version: 1, labels };
    this.save(serverId, workspaceId, next);
    return next;
  }
}
