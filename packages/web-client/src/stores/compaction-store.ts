/**
 * Compaction action state (sprint-074) — the one code path that sends `agent_compact_request`,
 * shared by the context-meter popover and the composer's `/compact` built-in so the two can never
 * differ on preconditions, in-progress tracking, or how the estimate lands.
 *
 * `pendingBySession` is the **local** in-progress flag: it covers the RPC round trip and is the
 * only in-progress signal against a daemon without the `compactionEvents` flag (no `compaction`
 * stream events, so no timeline row). Against newer daemons the timeline's `started` row says the
 * same thing (and also for automatic compactions this client didn't start) —
 * `use-is-compacting.ts` ORs the two.
 *
 * The estimate is written from the RPC response only when the daemon does NOT advertise
 * `compactionEvents`: with it, the live `completed` event already seeded the stats
 * (`agent-stream-events.ts`), and applying it twice would be the same write twice.
 */

import { create } from "zustand";
import { useConnectionStore } from "@pi-studio-ui/lib/connection/connection-store.js";
import { useSessionStore } from "@pi-studio-ui/stores/session-store.js";
import { applyCompactionEstimate } from "@pi-studio-ui/stores/stats-store.js";
import { isCompactionPending } from "@pi-studio-ui/timeline/compaction.js";

/** Why `compactSession` sent nothing. `failed` is not a refusal — the RPC ran and rejected. */
export type CompactRefusal = "disconnected" | "no-agent" | "running" | "compacting";

export type CompactResult =
  | { ok: true }
  | { ok: false; reason: CompactRefusal }
  /** The user cancelled mid-flight (`cancelCompaction`): Pi rejects the RPC after an abort, but
   * that is the requested outcome, not an error - the timeline's `canceled` divider says it. */
  | { ok: false; reason: "canceled" }
  | { ok: false; reason: "failed"; message: string };

/** Sessions whose in-flight compaction the user asked to cancel. Not reactive state: it only
 * decides how `compactSession` classifies the rejection that follows the abort. */
const cancelRequested = new Set<string>();

interface CompactionStoreState {
  pendingBySession: Record<string, true>;
  lastErrorBySession: Record<string, string>;
  /** Compact the session's agent. Resolves (never rejects) with a typed result. */
  compactSession(sessionId: string, instructions?: string): Promise<CompactResult>;
  /** Abort an in-progress compaction — Pi's `abort` cancels it, so this is the ordinary interrupt. */
  cancelCompaction(sessionId: string): Promise<void>;
  clearError(sessionId: string): void;
}

function without<T>(record: Record<string, T>, key: string): Record<string, T> {
  const { [key]: _removed, ...rest } = record;
  return rest;
}

export const useCompactionStore = create<CompactionStoreState>()((set, get) => ({
  pendingBySession: {},
  lastErrorBySession: {},

  async compactSession(sessionId, instructions) {
    const { client, status, serverInfo } = useConnectionStore.getState();
    if (!client || status !== "open") return { ok: false, reason: "disconnected" };
    const session = useSessionStore.getState().sessions[sessionId];
    if (!session?.agentId) return { ok: false, reason: "no-agent" };
    if (session.status === "running") return { ok: false, reason: "running" };
    if (get().pendingBySession[sessionId] || isCompactionPending(session.timeline.rows)) {
      return { ok: false, reason: "compacting" };
    }

    set((s) => ({
      pendingBySession: { ...s.pendingBySession, [sessionId]: true },
      lastErrorBySession: without(s.lastErrorBySession, sessionId),
    }));
    try {
      const payload = await client.agent(session.agentId).compact(instructions);
      if (!serverInfo?.features?.["compactionEvents"] && payload.estimatedTokensAfter != null) {
        applyCompactionEstimate(sessionId, payload.estimatedTokensAfter);
      }
      return { ok: true };
    } catch (error) {
      if (cancelRequested.has(sessionId)) return { ok: false, reason: "canceled" };
      const message = error instanceof Error ? error.message : String(error);
      set((s) => ({ lastErrorBySession: { ...s.lastErrorBySession, [sessionId]: message } }));
      return { ok: false, reason: "failed", message };
    } finally {
      cancelRequested.delete(sessionId);
      set((s) => ({ pendingBySession: without(s.pendingBySession, sessionId) }));
    }
  },

  async cancelCompaction(sessionId) {
    const client = useConnectionStore.getState().client;
    const agentId = useSessionStore.getState().sessions[sessionId]?.agentId;
    if (!client || !agentId) return;
    // Only a compaction this client started has an RPC to classify; marking an idle session
    // would mislabel the next, unrelated failure.
    if (get().pendingBySession[sessionId]) cancelRequested.add(sessionId);
    await client.agent(agentId).interrupt();
  },

  clearError(sessionId) {
    set((s) => ({ lastErrorBySession: without(s.lastErrorBySession, sessionId) }));
  },
}));
