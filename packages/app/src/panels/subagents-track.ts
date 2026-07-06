// Subagents track view model.
// clean-room-scope/features/feature-panels-ui.md § Subagents track

export type SubagentStatus = "running" | "idle" | "needs_attention" | "failed" | "archived";

export type SubagentEntry = {
  agentId: string;
  parentAgentId: string;
  title?: string;
  status: SubagentStatus;
  createdAt: number;
  isArchived: boolean;
  isPendingArchive: boolean;
};

export type SubagentTrackState = {
  entries: SubagentEntry[];
  expanded: boolean;
  archiveConfirmId?: string;
};

export const INITIAL_TRACK_STATE: SubagentTrackState = { entries: [], expanded: false };

// ─── Membership ───────────────────────────────────────────────────────────

/** Only active (not archived, not pending-archive) subagents are listed. */
export function trackMembers(allAgents: readonly SubagentEntry[], parentAgentId: string): SubagentEntry[] {
  return allAgents
    .filter((agent) => agent.parentAgentId === parentAgentId && !agent.isArchived && !agent.isPendingArchive)
    .sort((a, b) => a.createdAt - b.createdAt);
}

// ─── Header label ─────────────────────────────────────────────────────────

export function trackHeaderLabel(entries: readonly SubagentEntry[]): string {
  const running = entries.filter((e) => e.status === "running").length;
  const label = `${entries.length} subagent${entries.length === 1 ? "" : "s"}`;
  return running > 0 ? `${label} · ${running} running` : label;
}

// ─── Row chip ─────────────────────────────────────────────────────────────

export type SubagentChip = {
  agentId: string;
  label: string;
  status: SubagentStatus;
  needsAttention: boolean;
};

export function buildSubagentChip(entry: SubagentEntry): SubagentChip {
  return {
    agentId: entry.agentId,
    label: entry.title ?? "Loading…",
    status: entry.status,
    needsAttention: entry.status === "needs_attention",
  };
}

// ─── Archive flow ─────────────────────────────────────────────────────────

export type ArchiveConfirm = {
  agentId: string;
  message: string;
  isRunning: boolean;
};

export function buildArchiveConfirm(entry: SubagentEntry): ArchiveConfirm {
  const isRunning = entry.status === "running";
  return {
    agentId: entry.agentId,
    message: isRunning
      ? "Archive running subagent? This will stop it."
      : "Archive subagent?",
    isRunning,
  };
}

export function openArchiveConfirm(state: SubagentTrackState, agentId: string): SubagentTrackState {
  return { ...state, archiveConfirmId: agentId };
}

export function closeArchiveConfirm(state: SubagentTrackState): SubagentTrackState {
  return { ...state, archiveConfirmId: undefined };
}

export function confirmArchiveId(state: SubagentTrackState): string | undefined {
  return state.archiveConfirmId;
}

// ─── Track toggle ─────────────────────────────────────────────────────────

export function toggleTrack(state: SubagentTrackState): SubagentTrackState {
  return { ...state, expanded: !state.expanded };
}

// ─── Visibility ───────────────────────────────────────────────────────────

export function shouldRenderTrack(entries: readonly SubagentEntry[]): boolean {
  return entries.length > 0;
}
