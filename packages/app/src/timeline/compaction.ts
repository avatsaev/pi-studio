// Compaction marker model + load-full-history trigger.
// clean-room-scope/features/timeline-rendering.md § Compaction marker,
// task-003 § Compaction markers

export type CompactionStatus = "loading" | "completed";
export type CompactionTrigger = "automatic" | "manual";

export interface CompactionMarkerInput {
  status: CompactionStatus;
  trigger?: CompactionTrigger;
  /** Token count prior to compaction, if known. */
  preTokens?: number;
  /** Number of turns summarized, if known. */
  summarizedTurns?: number;
  /** The summary text shown when expanded. */
  summary?: string;
}

export interface CompactionMarkerModel {
  status: CompactionStatus;
  /** Center label for the horizontal-rule marker. */
  label: string;
  /** Whether a "Load full history" affordance should be offered. */
  canLoadFull: boolean;
  summary?: string;
}

export function buildCompactionMarker(input: CompactionMarkerInput): CompactionMarkerModel {
  if (input.status === "loading") {
    return { status: "loading", label: "Compacting…", canLoadFull: false, summary: input.summary };
  }
  return {
    status: "completed",
    label: compactionLabel(input),
    canLoadFull: true,
    summary: input.summary,
  };
}

function compactionLabel(input: CompactionMarkerInput): string {
  if (typeof input.summarizedTurns === "number") {
    const n = input.summarizedTurns;
    return `Conversation compacted — ${n} turn${n === 1 ? "" : "s"} summarized`;
  }
  if (typeof input.preTokens === "number") {
    return `Context compacted (${input.preTokens} tokens)`;
  }
  const how = input.trigger === "manual" ? "manually" : "automatically";
  return `Context ${how} compacted`;
}

/** Payload for a pagination fetch triggered by "Load full history". */
export interface LoadFullHistoryRequest {
  agentId: string;
  /** Fetch before this cursor (older history). */
  cursor?: string;
  direction: "before";
}

export function buildLoadFullHistoryRequest(agentId: string, cursor?: string): LoadFullHistoryRequest {
  return { agentId, cursor, direction: "before" };
}
