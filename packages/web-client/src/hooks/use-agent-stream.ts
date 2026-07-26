/**
 * Live timeline subscription for a chat session. Subscribes to
 * `client.agent(agentId).timeline.subscribe` whenever both the connection's `client` and the
 * session's `agentId` are available, routing every event through `applyAgentStreamEvent`
 * (POC_TO_APP_PLAN_UI.md §4.3). Also mirrors the POC's `handleAgentStream` turn-lifecycle →
 * `session.status` transitions so the Composer's Stop button and the session-list status dot
 * stay live.
 *
 * By design, a deferred draft's `agentId` is bound before any turn can start (at tab-open time
 * via `ensureMaterialized` in the Composer), so this subscription attaches before streaming
 * begins. There is no raw-broadcast first-turn workaround — every event is captured by the live
 * subscription, including the first turn.
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
