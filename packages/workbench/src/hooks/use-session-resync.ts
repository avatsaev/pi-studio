/**
 * Session resync: brings the sessions this client already shows up to date each time the connection
 * opens again (a reconnect in place after sleep or a network drop, or a Retry). The first open is
 * `use-session-restore.ts`'s; that restore runs once per page and skips an agent it already has, so
 * without this a turn that ran while the connection was down stayed missing until a reload, and a
 * session whose turn ended meanwhile stayed "running".
 *
 * For every session with an agent: the status from `list_agents_request`, and the whole timeline
 * fetched again and replaced (the same full fetch `use-timeline-reset-watch.ts` does after a fork;
 * the client keeps no sequence number to fetch only the tail). Agents created elsewhere while the
 * connection was down are not added.
 *
 * Live events keep arriving during the fetch. Each persisted one carries the daemon's timeline
 * `seq`, and a page reports the highest `seq` it covers, so an event newer than the last page is
 * applied again on top of the fetched timeline rather than lost in the replace.
 */

import { useEffect, useRef } from "react";
import type { PiStudioClient } from "@av-pi-studio/client";
import type { AgentStatus, AgentStreamEvent } from "@av-pi-studio/protocol";
import { useConnectionStore } from "../lib/connection/connection-store.js";
import { fetchTimelineEvents } from "../lib/protocol/timeline-paging.js";
import { useSessionStore } from "../stores/session-store.js";
import { applyStreamEvent, replayEvents } from "../timeline/reducer.js";
import { streamTimestamp } from "./agent-stream-events.js";

interface ListedAgent {
  agentId: string;
  status?: string;
}

interface LiveEvent {
  event: AgentStreamEvent;
  seq: number;
  timestamp?: string;
}

/** Sets each known session's status from the daemon's list. Best-effort: on a failed request the
 *  statuses stay as they are and the next turn event corrects them. */
async function resyncStatuses(client: PiStudioClient): Promise<void> {
  let agents: ListedAgent[] = [];
  try {
    const result = await client.connection.request<{ agents?: ListedAgent[] }>(
      "list_agents_request",
      { all: false },
    );
    agents = result.agents ?? [];
  } catch {
    return;
  }
  // Applied in the same turn the response arrives in: a turn event broadcast after the daemon
  // answered is delivered after it, so it is never overwritten by this older status.
  const sessionStore = useSessionStore.getState();
  for (const agent of agents) {
    if (agent.status) sessionStore.setStatusByAgentId(agent.agentId, agent.status as AgentStatus);
  }
}

/** Fetches one agent's timeline from the start and replaces the cached one. A failed fetch keeps
 *  the cached timeline: stale history is better than none. */
async function resyncTimeline(client: PiStudioClient, agentId: string): Promise<void> {
  const live: LiveEvent[] = [];
  const stopCollecting = client.agent(agentId).timeline.subscribe((event, meta) => {
    // An event without `seq` is live-only (partial tool output, queue state): the next one of its
    // kind replaces it, so there is nothing to carry over.
    if (typeof meta.seq !== "number") return;
    live.push({ event, seq: meta.seq, timestamp: streamTimestamp(meta.timestamp) });
  });

  try {
    let fetchedThrough = 0;
    const events = await fetchTimelineEvents(async (cursor) => {
      const page = await client.agent(agentId).timeline.fetch({
        direction: "after",
        cursor: cursor ?? undefined,
        limit: 200,
      });
      fetchedThrough = Math.max(fetchedThrough, page.seqEnd);
      return page;
    });

    let timeline = replayEvents(events);
    for (const { event, seq, timestamp } of live) {
      if (seq > fetchedThrough) timeline = applyStreamEvent(timeline, event, timestamp);
    }
    useSessionStore.getState().setTimelineByAgentId(agentId, timeline);
  } catch {
    // Keep what is shown.
  } finally {
    stopCollecting();
  }
}

/**
 * Exported for direct unit testing: this project's vitest config runs `.test.ts` under a plain Node
 * environment (no DOM), so the hook itself is verified live while this is driven directly.
 */
export async function runSessionResync(client: PiStudioClient): Promise<void> {
  const { order, sessions } = useSessionStore.getState();
  const agentIds = order.flatMap((id) => {
    const agentId = sessions[id]?.agentId;
    return agentId ? [agentId] : [];
  });
  if (agentIds.length === 0) return;

  await resyncStatuses(client);
  for (const agentId of agentIds) await resyncTimeline(client, agentId);
}

export function useSessionResync(): void {
  const client = useConnectionStore((s) => s.client);
  const status = useConnectionStore((s) => s.status);
  const openedBeforeRef = useRef(false);

  useEffect(() => {
    if (status !== "open" || !client) return;
    if (!openedBeforeRef.current) {
      // The first open: `useSessionRestore` hydrates every session from scratch.
      openedBeforeRef.current = true;
      return;
    }
    void runSessionResync(client);
  }, [status, client]);
}
