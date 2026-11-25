/**
 * Shared `AgentStreamEvent` → store-update logic, consumed by the live subscription
 * (`use-agent-stream.ts`), which attaches the instant a session's `agentId` is bound —
 * including a freshly materialized draft, before its first turn can possibly start streaming
 * (`Composer.tsx`'s file header) — so there is no separate raw-broadcast/first-turn-gate path
 * here anymore. The event goes to the timeline reducer, and `turn_started` also moves the
 * session's status through `lib/agent-status.ts`, the same rule that applies `agent_update`'s
 * status (`use-session-restore.ts` — the only thing that ENDS a turn) and the daemon's acceptance
 * of a send (`composer-send.ts`).
 */

import type { PiStudioClient } from "@av-pi-studio/client";
import type { AgentStreamEvent } from "@av-pi-studio/protocol";
import type { QueryClient } from "@tanstack/react-query";
import { useSessionStore } from "../stores/session-store.js";
import { applyCompactionEstimate } from "../stores/stats-store.js";
import { toolMutatesFiles, toolFilePath } from "../timeline/tool-mapping.js";
import { invalidateAfterToolCompletion } from "../lib/connection/files-changed.js";

/** The SDK's stream-meta timestamp (ISO-8601 or epoch millis) as the ISO string a row carries. */
export function streamTimestamp(timestamp: string | number | undefined): string | undefined {
  return typeof timestamp === "number" ? new Date(timestamp).toISOString() : timestamp;
}

export interface ApplyAgentStreamEventArgs {
  sessionId: string;
  event: AgentStreamEvent;
  /** Daemon-owned timestamp of this event's timeline row, forwarded from the SDK's stream meta. */
  timestamp?: string;
  client: PiStudioClient;
  queryClient: QueryClient;
}

export function applyAgentStreamEvent({
  sessionId,
  event,
  timestamp,
  client,
  queryClient,
}: ApplyAgentStreamEventArgs): void {
  const sessionStore = useSessionStore.getState();
  sessionStore.applyStreamEvent(sessionId, event, timestamp);
  sessionStore.applyStatusSignal(sessionId, { source: "stream", event });
  switch (event.kind) {
    case "compaction":
      // Pi reports null context usage after a compaction until the next LLM reply, so the
      // estimate is the only fresh number there is. Live-only: replayed history never reaches this
      // function, so a reload leaves stats alone (the meter shows unknown until the next poll).
      if (event.phase === "completed" && event.estimatedTokensAfter !== undefined) {
        applyCompactionEstimate(sessionId, event.estimatedTokensAfter);
      }
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
