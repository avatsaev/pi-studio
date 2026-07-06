/**
 * Timeline subscription hook — wires session store timeline to render items,
 * manages live stream subscription, initial page fetch, and pagination.
 *
 * See: clean-room-scope/features/timeline-rendering.md
 *      clean-room-scope/features/agent-sessions.md § streaming events
 */

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useAgentTimeline } from "./use-session-hooks.js";
import { useSessionStore } from "../store/session-store.js";
import { useClient } from "./client-context.js";
import {
  buildRenderItems,
  type RenderItem,
} from "../timeline/render-model.js";
import {
  INITIAL_AUTOSCROLL_STATE,
  onRowsAdded,
  onScroll,
  onJumpToBottom,
  onScrollComplete,
  type AutoscrollState,
} from "../timeline/autoscroll.js";
import {
  planInitialSync,
  DEFAULT_PAGE_LIMIT,
} from "../timeline/sync-planner.js";
import { streamEventToTimelineRow, type PageResult, type TimelineRow } from "../timeline/reducer.js";
import type { FetchAgentTimelineResponse } from "@av-pi-studio/protocol";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface UseAgentTimelineResult {
  /** Render-ready items for the virtualized list. */
  items: RenderItem[];
  /** Whether an older-page fetch is in progress. */
  loadingOlder: boolean;
  /** Whether there are older pages to load. */
  hasOlder: boolean;
  /** Autoscroll state for the timeline scroll container. */
  autoscroll: AutoscrollState;
  /** Pending new-message count (shown when autoscroll is detached). */
  newMessageCount: number;
  /** Load the next older page (called when user scrolls to top). */
  loadOlder(): Promise<void>;
  /** Jump to latest (resume autoscroll). */
  jumpToLatest(): void;
  /** Notify the hook that a scroll event occurred. */
  onScroll(distanceFromBottom: number): void;
  /** Notify the hook that a scroll animation completed. */
  onScrollComplete(): void;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useAgentTimelineSubscription(
  agentId: string | undefined,
): UseAgentTimelineResult {
  const client = useClient();
  const timeline = useAgentTimeline(agentId);
  const store = useSessionStore;

  const [loadingOlder, setLoadingOlder] = useState(false);
  const [autoscroll, setAutoscroll] = useState<AutoscrollState>(INITIAL_AUTOSCROLL_STATE);
  const [newMessageCount, setNewMessageCount] = useState(0);
  const prevRowCount = useRef(0);

  // ── Initial page fetch + live subscription on mount ─────────────────────────
  useEffect(() => {
    if (!agentId || !client) return;
    const cursor = timeline?.cursor;
    const plan = planInitialSync(agentId, cursor);
    let cancelled = false;

    async function fetchInitial() {
      if (!client || !agentId) return;
      try {
        const resp = await client.agent(agentId).timeline.fetch({
          cursor: plan.fetchRequest.cursor,
          direction: plan.fetchRequest.direction as "before" | "after",
          limit: plan.fetchRequest.limit,
        });
        if (cancelled) return;
        // Ensure the agent exists in the store before merging — the store's
        // mergePage/applyStreamEvent no-op when the agent is absent (e.g. when
        // this agent was created by another client or predates this session, so
        // no agent_update broadcast seeded it).
        if (!store.getState().agents[agentId]) {
          store.getState().upsertAgent({ agentId });
        }
        const page = responseToPageResult(agentId, resp);
        store.getState().mergePage(agentId, page);
      } catch {
        // Timeline fetch failed — use whatever live rows we have
      }
    }

    void fetchInitial();

    // Subscribe to live stream events — always subscribe fresh per effect lifecycle
    const unsub = client.agent(agentId).timeline.subscribe((event) => {
      if (!cancelled) {
        store.getState().applyStreamEvent(agentId, event as unknown as import("@av-pi-studio/protocol").AgentStreamEvent);
      }
    });

    return () => {
      cancelled = true;
      unsub();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentId, client]);

  // ── Track new messages while detached ─────────────────────────────────────
  const rows = timeline?.rows ?? [];
  const items = useMemo(() => buildRenderItems(rows), [rows]);

  useEffect(() => {
    if (rows.length > prevRowCount.current) {
      const added = rows.length - prevRowCount.current;
      const result = onRowsAdded(autoscroll);
      if (!result.shouldScroll) {
        setNewMessageCount((n) => n + added);
      } else {
        setNewMessageCount(0);
      }
      setAutoscroll(result);
    }
    prevRowCount.current = rows.length;
  }, [rows.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Load older page ────────────────────────────────────────────────────────
  const loadOlder = useCallback(async () => {
    if (!agentId || !client || loadingOlder) return;
    // Read the latest cursor from the store (not from stale closure)
    const currentTimeline = store.getState().agents[agentId]?.timeline;
    const cursor = currentTimeline?.cursor;
    if (!cursor) return;
    setLoadingOlder(true);
    try {
      const resp = await client.agent(agentId).timeline.fetch({
        cursor,
        direction: "before",
        limit: DEFAULT_PAGE_LIMIT,
      });
      const page = responseToPageResult(agentId, resp);
      store.getState().mergePage(agentId, page);
    } finally {
      setLoadingOlder(false);
    }
  }, [agentId, client, loadingOlder]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Autoscroll handlers ────────────────────────────────────────────────────
  const handleScroll = useCallback((distanceFromBottom: number) => {
    setAutoscroll((s) => onScroll(s, distanceFromBottom));
    if (distanceFromBottom <= 80) setNewMessageCount(0);
  }, []);

  const jumpToLatest = useCallback(() => {
    const result = onJumpToBottom(autoscroll);
    setAutoscroll(result);
    setNewMessageCount(0);
  }, [autoscroll]);

  const handleScrollComplete = useCallback(() => {
    setAutoscroll((s) => onScrollComplete(s));
  }, []);

  const hasOlder = !!(timeline?.cursor && timeline.cursor !== "");

  return {
    items,
    loadingOlder,
    hasOlder,
    autoscroll,
    newMessageCount,
    loadOlder,
    jumpToLatest,
    onScroll: handleScroll,
    onScrollComplete: handleScrollComplete,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function responseToPageResult(_agentId: string, resp: FetchAgentTimelineResponse): PageResult {
  const r = resp as Record<string, unknown>;
  const rawItems = (r["items"] as unknown[]) ?? [];

  // Daemon timeline items are grouping wrappers: `{ kind, sourceSeq, event }`
  // for single events, or `{ kind, sourceSeqStart, events: [...] }` for grouped
  // assistant blocks. Flatten to inner events and map each through the same
  // event→row logic the live stream uses, so page + live rows are identical.
  const rows: TimelineRow[] = [];
  let running = 0;
  for (const item of rawItems) {
    const it = item as Record<string, unknown>;
    const base =
      (it["sourceSeq"] as number | undefined) ??
      (it["sourceSeqStart"] as number | undefined) ??
      running;
    const events = Array.isArray(it["events"])
      ? (it["events"] as unknown[])
      : it["event"] !== undefined
        ? [it["event"]]
        : [it];
    events.forEach((ev, j) => {
      const row = streamEventToTimelineRow(ev, { seq: base + j, source: "page" });
      if (row) rows.push(row);
      running = Math.max(running, base + j + 1);
    });
  }

  return {
    rows,
    seqStart: (r["seqStart"] as number | undefined) ?? (rows[0]?.seqStart ?? 0),
    seqEnd: (r["seqEnd"] as number | undefined) ?? (rows.length ? rows[rows.length - 1]!.seqEnd : 0),
    hasNewer: (r["hasNewer"] as boolean | undefined) ?? false,
    startCursor: (r["startCursor"] as string | null | undefined) ?? undefined,
    endCursor: (r["endCursor"] as string | null | undefined) ?? undefined,
  };
}
