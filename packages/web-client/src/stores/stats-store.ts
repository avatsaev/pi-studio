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
  /** 0–1 fraction (matches the wire `agentContextUsageSchema.percent` convention). */
  contextPercent?: number;
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
