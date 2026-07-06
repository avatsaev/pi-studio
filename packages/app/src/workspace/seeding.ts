// Empty workspace draft seeding and route ?open= intent resolution.
// clean-room-scope/features/workspace-ui.md § Empty-workspace draft seeding

import type { WorkspaceOpenIntent } from "../runtime/route-grammar.js";
import { createWorkspaceTab, openIntentToTabTarget, type WorkspaceTab, type WorkspaceTabTarget } from "./tabs.js";

export type WorkspaceHydrationState = {
  routeFocused: boolean;
  persistenceKey?: string;
  workspaceDir?: string;
  layoutHydrated: boolean;
  agentsHydrated: boolean;
  terminalsHydrated: boolean;
  activeAgentCount: number;
  terminalCount: number;
  tabs: readonly WorkspaceTab[];
};

export function shouldSeedDraft(state: WorkspaceHydrationState): boolean {
  return Boolean(
    state.routeFocused &&
    state.persistenceKey &&
    state.workspaceDir &&
    state.layoutHydrated &&
    state.agentsHydrated &&
    state.terminalsHydrated &&
    state.activeAgentCount === 0 &&
    state.terminalCount === 0 &&
    state.tabs.length === 0,
  );
}

export function seedDraftTab(state: WorkspaceHydrationState, draftId: string, createdAt = Date.now()): WorkspaceTab | null {
  return shouldSeedDraft(state) ? createWorkspaceTab({ kind: "draft", draftId, setup: { provider: "default", cwd: state.workspaceDir! } }, createdAt) : null;
}

export function targetFromOpenIntent(intent: WorkspaceOpenIntent | null): WorkspaceTabTarget | null {
  return intent ? openIntentToTabTarget(intent) : null;
}

export type EntryResolution =
  | { action: "focus-existing"; tabId: string }
  | { action: "open-target"; target: WorkspaceTabTarget }
  | { action: "seed-draft"; tab: WorkspaceTab }
  | { action: "none" };

export function resolveWorkspaceEntry(input: { state: WorkspaceHydrationState; openIntent: WorkspaceOpenIntent | null; nextDraftId: string; now?: number }): EntryResolution {
  const target = targetFromOpenIntent(input.openIntent);
  if (target) {
    const existing = input.state.tabs.find((tab) => tab.target.kind === target.kind && tab.tabId === createWorkspaceTab(target).tabId);
    return existing ? { action: "focus-existing", tabId: existing.tabId } : { action: "open-target", target };
  }
  const seeded = seedDraftTab(input.state, input.nextDraftId, input.now);
  return seeded ? { action: "seed-draft", tab: seeded } : { action: "none" };
}
