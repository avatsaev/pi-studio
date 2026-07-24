/**
 * Shared `AgentStreamEvent` → store-update logic, consumed by the live subscription
 * (`use-agent-stream.ts`), which attaches the instant a session's `agentId` is bound —
 * including a freshly materialized draft, before its first turn can possibly start streaming
 * (`Composer.tsx`'s file header) — so there is no separate raw-broadcast/first-turn-gate path
 * here anymore.
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
