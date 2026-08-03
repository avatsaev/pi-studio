/**
 * `use-session-stats` — polls `agent_session_stats_request` (SDK `client.agent(id).sessionStats()`)
 * for one session's context/token/cost usage and poll-reconciled model, writing into `stats-store`
 * (sprint-042). This data is **pull-only**: no `AgentStreamEvent` kind carries context/token/cost
 * (see `agentStreamEventSchema` in `@av-pi-studio/protocol`), so there is no push channel to react
 * to — a poll is the only option.
 *
 * Poll triggers:
 * - once when a session with a bound `agentId` becomes the argument (mount / session switch /
 *   agent bound after create),
 * - every `POLL_INTERVAL_MS` as a backstop while that stays true,
 * - immediately when the session's `status` transitions away from `"running"` — a proxy for
 *   `turn_completed`/`turn_failed`/`turn_canceled` that avoids a second raw `agent_stream`
 *   subscription: `agent-stream-events.ts` already drives exactly that status transition off those
 *   stream events, so watching `SessionEntry.status` here is equivalent and simpler.
 *
 * A session with no `agentId` yet (a fresh, never-run chat) polls nothing — there is no agent to
 * ask. Failures (unsupported provider, no live session right now) are swallowed; the previous
 * cached value in `stats-store` is left untouched rather than cleared, so a transient failure
 * never blanks the status bar.
 */

import { useEffect, useRef } from "react";
import type { AgentSessionStatsResponse, AgentStatus } from "@av-pi-studio/protocol";
import { useConnectionStore } from "@pi-studio-ui/lib/connection/connection-store.js";
import { useSessionStore } from "@pi-studio-ui/stores/session-store.js";
import { useStatsStore, type SessionStats } from "@pi-studio-ui/stores/stats-store.js";

const POLL_INTERVAL_MS = 12_000;

type SessionStatus = AgentStatus | "idle" | undefined;

/** True exactly when a turn just ended: `prev` was `"running"` and `next` no longer is. Pure —
 * exported for direct unit testing without rendering the hook. */
export function shouldRepollOnStatusChange(prev: SessionStatus, next: SessionStatus): boolean {
  return prev === "running" && next !== "running";
}

/** Maps the RPC payload onto `stats-store`'s flatter `SessionStats` shape, writing only fields the
 * payload actually carries — `setStats`'s merge treats an explicit `undefined` value as "clear
 * this field", not "leave it alone" (object spread doesn't distinguish an absent key from one set
 * to `undefined`), so a poll response that omits e.g. `cost` must never wipe a previously known
 * cost. Also reconciles `session-store`'s `model` — the status bar's model *segment* reads
 * `SessionEntry.model` (seeded by create/restore, updated live by `agent_update`), not
 * `stats-store`, so the poll must write through to keep that value authoritative (design intent:
 * "stats poll authoritative + agent_update for instant feedback" — a payload `model` this session
 * never learned any other way, e.g. right after `/model` cycle, must still reach the segment).
 * Exported for direct unit testing without rendering the hook. */
export function applySessionStats(
  sessionId: string,
  payload: AgentSessionStatsResponse["payload"],
): void {
  const patch: Partial<SessionStats> = {};
  if (payload.contextUsage?.tokens != null) patch.contextTokens = payload.contextUsage.tokens;
  if (payload.contextUsage?.contextWindow !== undefined) {
    patch.contextWindow = payload.contextUsage.contextWindow;
  }
  if (payload.contextUsage?.percent != null) patch.contextPercent = payload.contextUsage.percent;
  if (payload.tokens?.total !== undefined) patch.totalTokens = payload.tokens.total;
  if (payload.tokens?.input !== undefined) patch.inputTokens = payload.tokens.input;
  if (payload.tokens?.output !== undefined) patch.outputTokens = payload.tokens.output;
  if (payload.cost !== undefined) patch.cost = payload.cost;
  if (payload.model !== undefined) {
    patch.model = payload.model;
    useSessionStore.getState().setModel(sessionId, payload.model);
  }
  useStatsStore.getState().setStats(sessionId, patch);
}

export function useSessionStats(sessionId: string | null): void {
  const client = useConnectionStore((s) => s.client);
  const status = useConnectionStore((s) => s.status);
  const agentId = useSessionStore((s) =>
    sessionId ? (s.sessions[sessionId]?.agentId ?? null) : null,
  );
  const sessionStatus = useSessionStore((s) =>
    sessionId ? s.sessions[sessionId]?.status : undefined,
  );
  const inFlightRef = useRef(false);
  const prevStatusRef = useRef<typeof sessionStatus>(undefined);

  // Initial poll (on mount / whenever the polled agent identity changes) + interval backstop.
  useEffect(() => {
    if (status !== "open" || !client || !sessionId || !agentId) return;

    let cancelled = false;
    const poll = async () => {
      if (inFlightRef.current) return;
      inFlightRef.current = true;
      try {
        const payload = await client.agent(agentId).sessionStats();
        if (!cancelled) applySessionStats(sessionId, payload);
      } catch {
        // Best-effort — leave the prior cached value in place.
      } finally {
        inFlightRef.current = false;
      }
    };

    void poll();
    const interval = setInterval(() => void poll(), POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [status, client, sessionId, agentId]);

  // Extra immediate poll when a turn just ended (running -> anything else).
  useEffect(() => {
    const prevStatus = prevStatusRef.current;
    prevStatusRef.current = sessionStatus;
    if (!shouldRepollOnStatusChange(prevStatus, sessionStatus)) return;
    if (status !== "open" || !client || !sessionId || !agentId) return;
    inFlightRef.current = false; // a stale in-flight interval poll shouldn't block this one
    void client
      .agent(agentId)
      .sessionStats()
      .then((payload) => applySessionStats(sessionId, payload))
      .catch(() => {});
  }, [sessionStatus, status, client, sessionId, agentId]);
}
