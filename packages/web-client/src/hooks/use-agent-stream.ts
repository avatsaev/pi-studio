/**
 * Live timeline subscription for a chat session. Subscribes to
 * `client.agent(agentId).timeline.subscribe` whenever both the connection's `client` and the
 * session's `agentId` are available, routing every event through `applyAgentStreamEvent`
 * (POC_TO_APP_PLAN_UI.md §4.3). Also mirrors the POC's `handleAgentStream` turn-lifecycle →
 * `session.status` transitions so the Composer's Stop button and the session-list status dot
 * stay live.
 *
 * NOTE: this only covers events that arrive *after* the subscription attaches, which requires a
 * bound `agentId`. The daemon runs the whole first turn of a brand-new agent *before*
 * `create_agent_request` resolves, so `Composer.handleSend` applies that first turn live from the
 * raw broadcast (latching the agent id from the first `agent_stream` frame it sees) and only
 * calls `bindAgent` once the RPC resolves — after the turn is already applied. This hook therefore
 * attaches only in time for *follow-up* turns, which is exactly what avoids double-applying the
 * first turn (the reducer is not event-id-idempotent).
 */

import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useConnectionStore } from "@pi-studio-ui/lib/connection/connection-store.js";
import { useSessionStore } from "@pi-studio-ui/stores/session-store.js";
import { applyAgentStreamEvent } from "./agent-stream-events.js";

export function useAgentStream(sessionId: string): void {
  const client = useConnectionStore((s) => s.client);
  const agentId = useSessionStore((s) => s.sessions[sessionId]?.agentId ?? null);
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!client || !agentId) return;

    const unsubscribe = client.agent(agentId).timeline.subscribe((event) => {
      applyAgentStreamEvent({ sessionId, event, client, queryClient });
    });

    return unsubscribe;
  }, [client, agentId, sessionId, queryClient]);
}
