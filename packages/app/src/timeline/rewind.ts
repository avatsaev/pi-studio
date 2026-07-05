// Client rewind menu and mutation model.
// clean-room-scope/features/rewind.md § Rewind menu, § Post-rewind client state sync

import type { AgentCapabilityFlags } from "@av-pi-studio/protocol";

export type RewindMode = "conversation" | "files" | "both";

export type RewindMenuItem = {
  mode: RewindMode;
  label: string;
  description: string;
};

const REWIND_LABELS: Record<RewindMode, { label: string; description: string }> = {
  conversation: { label: "Rewind conversation", description: "Undo this message and all following turns in the conversation" },
  files: { label: "Rewind files", description: "Revert workspace file changes since this message" },
  both: { label: "Rewind conversation & files", description: "Undo this message and revert all file changes made after it" },
};

// Build the rewind menu items from capability flags. Returns [] if no modes are supported.
export function rewindMenuItems(capabilities: Partial<AgentCapabilityFlags>): RewindMenuItem[] {
  const items: RewindMenuItem[] = [];
  if (capabilities.supportsRewindConversation) items.push({ mode: "conversation", ...REWIND_LABELS.conversation });
  if (capabilities.supportsRewindFiles) items.push({ mode: "files", ...REWIND_LABELS.files });
  if (capabilities.supportsRewindBoth) items.push({ mode: "both", ...REWIND_LABELS.both });
  return items;
}

export function shouldShowRewindMenu(capabilities: Partial<AgentCapabilityFlags>): boolean {
  return rewindMenuItems(capabilities).length > 0;
}

// In-flight guard: only one rewind may be pending at a time.
export type RewindMutationState =
  | { status: "idle" }
  | { status: "pending"; mode: RewindMode; messageId: string }
  | { status: "error"; error: string };

export const REWIND_IDLE: RewindMutationState = { status: "idle" };

export function startRewind(messageId: string, mode: RewindMode): RewindMutationState {
  return { status: "pending", mode, messageId };
}

export function rewindSuccess(_state: RewindMutationState): RewindMutationState {
  return { status: "idle" };
}

export function rewindError(_state: RewindMutationState, error: string): RewindMutationState {
  return { status: "error", error };
}

export function isRewindPending(state: RewindMutationState): boolean {
  return state.status === "pending";
}

// Post-rewind client sync: what to do after a successful rewind.
export type PostRewindAction =
  | { kind: "refetch-tail"; agentId: string }
  | { kind: "restore-composer"; text: string }
  | { kind: "noop" };

export function postRewindActions(input: {
  mode: RewindMode;
  agentId: string;
  rewoundMessageText: string;
  composerEmpty: boolean;
}): PostRewindAction[] {
  const actions: PostRewindAction[] = [];
  if (input.mode !== "files") {
    actions.push({ kind: "refetch-tail", agentId: input.agentId });
    if (input.composerEmpty && input.rewoundMessageText) {
      actions.push({ kind: "restore-composer", text: input.rewoundMessageText });
    }
  }
  return actions.length > 0 ? actions : [{ kind: "noop" }];
}
