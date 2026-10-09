/**
 * Stats store — per-session context/token/cost usage + poll-reconciled model, for the workspace
 * status bar (sprint-042). Sourced from `agent_session_stats_request` (SDK
 * `client.agent(id).sessionStats()`), which is pull-only: no stream event carries this data (see
 * `use-session-stats.ts`, which polls it). Keyed by **sessionId**, not `agentId` — a fresh session
 * has no `agentId` yet, and keying by sessionId lets switching back to a previously-visited
 * session show its last-known stats instantly instead of a blank flash while a fresh poll runs.
 */

import { create } from "zustand";

export interface SessionStats {
  contextTokens?: number;
  contextWindow?: number;
  /**
   * Context usage as a **0–100** percentage — Pi's own scale (`(tokens / contextWindow) * 100`),
   * passed through the wire's `agentContextUsageSchema.percent` untouched. Never a 0–1 fraction:
   * `context-meter.ts` divides by 100 to get one.
   */
  contextPercent?: number;
  /**
   * True when `contextTokens`/`contextPercent` came from a compaction's `estimatedTokensAfter`
   * rather than a stats poll (Pi reports null usage after a compaction until the next LLM reply).
   * Cleared by the first poll that carries real tokens.
   */
  contextEstimated?: boolean;
  totalTokens?: number;
  inputTokens?: number;
  outputTokens?: number;
  cost?: number;
  /** Poll-reconciled model id — see `agent_session_stats_response.payload.model` (sprint-042). */
  model?: string;
}

interface StatsStoreState {
  bySession: Record<string, SessionStats>;

  /** Shallow-merge a partial update into one session's stats (missing keys are left untouched). */
  setStats(sessionId: string, partial: Partial<SessionStats>): void;
  clear(sessionId: string): void;
}

/**
 * Seed a session's context numbers from a compaction's `estimatedTokensAfter`. Pi reports null
 * context usage after a compaction until the next LLM reply, so the estimate is the only fresh
 * number there is; the next poll that carries real tokens replaces it (`contextEstimated: false`).
 * Shared by the live `compaction` stream event and the compact RPC response (the fallback for
 * daemons without `compactionEvents`) so the two can never disagree about the scale: the percent
 * is Pi's 0–100, multiplied before dividing so round inputs stay exact.
 */
export function applyCompactionEstimate(sessionId: string, estimatedTokensAfter: number): void {
  const { bySession, setStats } = useStatsStore.getState();
  const window = bySession[sessionId]?.contextWindow;
  setStats(sessionId, {
    contextTokens: estimatedTokensAfter,
    // Explicit undefined clears a stale pre-compaction percent when the window is unknown.
    contextPercent: window ? (estimatedTokensAfter * 100) / window : undefined,
    contextEstimated: true,
  });
}

export const useStatsStore = create<StatsStoreState>()((set) => ({
  bySession: {},

  setStats(sessionId, partial) {
    set((s) => ({
      bySession: {
        ...s.bySession,
        [sessionId]: { ...s.bySession[sessionId], ...partial },
      },
    }));
  },

  clear(sessionId) {
    set((s) => {
      const { [sessionId]: _removed, ...rest } = s.bySession;
      return { bySession: rest };
    });
  },
}));
