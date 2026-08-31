/**
 * Timeline reset watch — listens for `agent_timeline_reset` (a JSON push, broadcast to **every**
 * active session unconditionally whenever a fork rebinds an agent's native session handle,
 * `packages/server/src/agent/slash-command-operations.ts`'s `handleFork`, sprint-071/task-003) and
 * fully replaces that agent's cached timeline with a fresh, from-scratch authoritative refetch.
 *
 * Follows the same local-interface-plus-type-guard convention as `checkout_status_update` /
 * `file_changed` / `terminals_update` (root AGENTS.md § Protocol overview) — no protocol-package
 * schema exists for this push family, and none is needed: it is a per-connection JSON broadcast,
 * not a per-path subscription.
 *
 * This is the **convergence backbone** for conversation fork (sprint-072/task-001): the requester
 * takes no bespoke refresh path, so a second browser window, a relay-connected phone, and the
 * initiating tab all converge through this one code path once the daemon's post-fork resync
 * broadcasts. `reason` is deliberately treated as opaque — the daemon documents it as an open
 * string reserved for other rebind operations (`/new`, `/resume`, `/clone`, `switch_session`) to
 * reuse later, so this handler never branches on its value; every reset gets the same full replace.
 *
 * Hydrated rows carry fresh epoch/seq numbering after a fork (`session-hydration.ts`), so any
 * cursor a client holds from before the reset is meaningless afterwards — the refetch always
 * starts from `cursor: null` (`fetchTimelineEvents`'s own contract), never a tail-sync. Replacing
 * the timeline wholesale with authoritative rows also clears any pending optimistic user row for
 * the agent as a side effect: an optimistic row only ever exists in this client's local state, so a
 * fresh server-truth replay can never reproduce one.
 */

import { useEffect } from "react";
import type { PiStudioClient } from "@av-pi-studio/client";
import { useConnectionStore } from "@pi-studio-ui/lib/connection/connection-store.js";
import { useSessionStore } from "@pi-studio-ui/stores/session-store.js";
import { EMPTY_TIMELINE, replayEvents } from "@pi-studio-ui/timeline/reducer.js";
import { fetchTimelineEvents } from "@pi-studio-ui/lib/protocol/timeline-paging.js";

export interface AgentTimelineResetMessage {
  type: "agent_timeline_reset";
  agentId: string;
  reason?: string;
}

export function isAgentTimelineReset(message: unknown): message is AgentTimelineResetMessage {
  return (
    typeof message === "object" &&
    message !== null &&
    (message as { type?: unknown }).type === "agent_timeline_reset" &&
    typeof (message as { agentId?: unknown }).agentId === "string"
  );
}

/**
 * Drops the agent's cached timeline and refetches it from scratch, paging to completion. A no-op
 * (no fetch issued) when this client has no cached session for `agentId` at all — cheap, and avoids
 * a fetch storm for agents this tab was never showing. Exported for direct unit testing — this
 * project's vitest config runs `.test.ts` under a plain Node environment (no DOM), so the hook
 * itself is verified by smoke test while this is driven directly (mirrors `use-session-restore.ts`'s
 * `runSessionRestore`).
 */
export async function handleAgentTimelineReset(
  client: PiStudioClient,
  agentId: string,
): Promise<void> {
  const sessionStore = useSessionStore.getState();
  if (!sessionStore.findByAgentId(agentId)) return;

  let timeline = EMPTY_TIMELINE;
  try {
    // Page to completion, starting from cursor: null — never reuse a cursor from before the
    // reset (timeline-paging.ts's fetchTimelineEvents always starts a fresh fetch this way).
    const events = await fetchTimelineEvents((cursor) =>
      client.agent(agentId).timeline.fetch({
        direction: "after",
        cursor: cursor ?? undefined,
        limit: 200,
      }),
    );
    timeline = replayEvents(events);
  } catch {
    // Best-effort, matching use-session-restore.ts's precedent: an unreadable timeline still
    // clears the abandoned branch rather than leaving it displayed as current.
  }
  useSessionStore.getState().setTimelineByAgentId(agentId, timeline);
}

export function useTimelineResetWatch(): void {
  const client = useConnectionStore((s) => s.client);

  useEffect(() => {
    if (!client) return;
    return client.connection.onSessionMessage((msg) => {
      const message: unknown = msg;
      if (!isAgentTimelineReset(message)) return;
      void handleAgentTimelineReset(client, message.agentId);
    });
  }, [client]);
}
