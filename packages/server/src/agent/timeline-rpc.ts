import type { HandlerRegistry } from "../ws/router.js";
import { getTimeline } from "./agent-service.js";
import { DEFAULT_PAGE_SIZE } from "./timeline-store.js";

/**
 * `fetch_agent_timeline_request` handler (features/timeline-streaming.md § Fetch request/response,
 * § Behavior — server). Returns full projected items (never deltas) with all paging fields. Bounded
 * at `DEFAULT_PAGE_SIZE`; clients page to completion (`hasNewer:false`).
 */
export function registerTimelineHandler(registry: HandlerRegistry): void {
  registry.register("fetch_agent_timeline_request", (ctx): Record<string, unknown> => {
    const msg = ctx.message as Record<string, unknown>;
    const agentId = msg.agentId as string;
    const direction = (msg.direction as "before" | "after") ?? "after";
    const cursor = msg.cursor as string | null | undefined;
    const limit = typeof msg.limit === "number" && msg.limit > 0 ? msg.limit : DEFAULT_PAGE_SIZE;

    const timeline = getTimeline(agentId);
    if (!timeline) {
      // Agent has no in-memory timeline yet (e.g. restarted daemon without run data).
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
