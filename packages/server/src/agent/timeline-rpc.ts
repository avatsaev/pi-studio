import type { HandlerRegistry } from "../ws/router.js";
import { ensureTimelineSeeded, getTimeline } from "./agent-service.js";
import { DEFAULT_PAGE_SIZE } from "./timeline-store.js";
import type { AgentManager } from "./agent-manager.js";
import type { AgentClient } from "./provider-contract.js";

export interface TimelineHandlerDeps {
  manager: AgentManager;
  resolveClient: (provider: string) => AgentClient;
}

/**
 * `fetch_agent_timeline_request` handler (features/timeline-streaming.md § Fetch request/response,
 * § Behavior — server). Returns full projected items (never deltas) with all paging fields. Bounded
 * at `DEFAULT_PAGE_SIZE`; clients page to completion (`hasNewer:false`).
 *
 * A restarted daemon has no in-memory `AgentTimelineStore` for any agent (it lives only in
 * process memory — see agent-service.ts). Rather than returning an empty page, fall back to the
 * agent's provider re-deriving the timeline from its own durable native history (e.g. `pi`'s
 * on-disk JSONL session file via `AgentClient.hydrateTimeline`), keyed off the record's persisted
 * `persistence` handle. The result is seeded once into the in-memory store so subsequent pages
 * (and any later live turn) build on it normally.
 */
export function registerTimelineHandler(
  registry: HandlerRegistry,
  deps: TimelineHandlerDeps,
): void {
  registry.register("fetch_agent_timeline_request", (ctx): Record<string, unknown> => {
    const msg = ctx.message as Record<string, unknown>;
    const agentId = msg.agentId as string;
    const direction = (msg.direction as "before" | "after") ?? "after";
    const cursor = msg.cursor as string | null | undefined;
    const limit = typeof msg.limit === "number" && msg.limit > 0 ? msg.limit : DEFAULT_PAGE_SIZE;

    ensureTimelineSeeded(agentId, deps.manager, deps.resolveClient);
    const timeline = getTimeline(agentId);

    if (!timeline) {
      // No in-memory timeline and no rehydratable native history — genuinely empty.
      return {
        type: "fetch_agent_timeline_response",
        requestId: ctx.requestId ?? "",
        agentId,
        items: [],
        seqStart: 0,
        seqEnd: 0,
        sourceSeqRanges: [],
        collapsed: false,
        hasNewer: false,
        startCursor: null,
        endCursor: null,
      };
    }

    const page = timeline.page({ direction, cursor, limit });
    return {
      type: "fetch_agent_timeline_response",
      requestId: ctx.requestId ?? "",
      agentId,
      ...page,
    };
  });
}
