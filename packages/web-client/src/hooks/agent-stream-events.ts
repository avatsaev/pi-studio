/**
 * Shared `AgentStreamEvent` → store-update logic, used both by the live subscription
 * (`use-agent-stream.ts`) and by the live first-turn apply in `Composer.tsx` (see its comment for
 * why: `create_agent_request` blocks until the whole first turn completes, so the timeline is fed
 * from the raw broadcast as events arrive rather than from a not-yet-attached subscription).
 */

import type { PiStudioClient } from "@av-pi-studio/client";
import type { AgentStreamEvent } from "@av-pi-studio/protocol";
import type { QueryClient } from "@tanstack/react-query";
import { useSessionStore } from "@pi-studio-ui/stores/session-store.js";
import { toolMutatesFiles, toolFilePath } from "@pi-studio-ui/timeline/tool-mapping.js";
import { invalidateAfterToolCompletion } from "@pi-studio-ui/lib/connection/files-changed.js";

export interface ApplyAgentStreamEventArgs {
  sessionId: string;
  event: AgentStreamEvent;
  client: PiStudioClient;
  queryClient: QueryClient;
}

/**
 * Correlates first-turn `agent_stream` broadcasts with the agent a specific `createAgent` call
 * just spawned. `create_agent_request` doesn't resolve with the new `agentId` until the whole
 * first turn completes, so `Composer.handleSend` watches the raw broadcast and applies frames as
 * they arrive — but the socket is shared across every open session, and another session's agent
 * can be mid-turn concurrently. The first `agent_stream` frame observed after subscribing is
 * therefore NOT necessarily this call's own agent. Only latch onto an `agentId` once its
 * canonical `user_message` echo is seen (`messageId === clientMessageId`, minted by this call and
 * echoed back verbatim by the daemon — `agent-service.ts` `runTurn`), then accept only further
 * frames carrying that same `agentId`. Returns a predicate reporting whether a given frame belongs
 * to this turn and should be applied.
 */
export function createFirstTurnGate(
  clientMessageId: string,
): (msg: { agentId: string; event: AgentStreamEvent }) => boolean {
  let liveAgentId: string | null = null;
  return (msg) => {
    if (liveAgentId === null) {
      if (msg.event.kind !== "user_message" || msg.event.messageId !== clientMessageId) return false;
      liveAgentId = msg.agentId;
    }
    return msg.agentId === liveAgentId;
  };
}

export function applyAgentStreamEvent({
  sessionId,
  event,
  client,
  queryClient,
}: ApplyAgentStreamEventArgs): void {
  const sessionStore = useSessionStore.getState();
  sessionStore.applyStreamEvent(sessionId, event);
  switch (event.kind) {
    case "turn_started":
      sessionStore.setStatus(sessionId, "running");
      break;
    case "turn_completed":
      sessionStore.setStatus(sessionId, "idle");
      break;
    case "turn_failed":
      sessionStore.setStatus(sessionId, "error");
      break;
    case "turn_canceled":
      sessionStore.setStatus(sessionId, "idle");
      break;
    case "tool_call": {
      if (event.status === "completed" && toolMutatesFiles(event.tool)) {
        const session = sessionStore.sessions[sessionId];
        const cwd = session?.cwd || null;
        invalidateAfterToolCompletion(queryClient, client, cwd, toolFilePath(event.tool));
      }
      break;
    }
    default:
      break;
  }
}
