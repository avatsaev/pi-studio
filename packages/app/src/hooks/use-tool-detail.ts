/**
 * Tool-call detail hook — return the detail already present on the stream item,
 * or lazily fetch it via the `agent.toolCall.detail` RPC when the card is
 * expanded and the daemon advertises the capability.
 *
 * clean-room-scope/features/timeline-rendering.md § Tool-call cards, § Expanded tool detail
 */

import { useQuery } from "@tanstack/react-query";
import { useClient } from "./client-context.js";
import type { ToolCallDetail } from "../timeline/tool-cards.js";

export const TOOL_DETAIL_RPC = "agent.toolCall.detail.request" as const;

export const TOOL_DETAIL_QUERY_KEYS = {
  detail: (agentId: string, callId: string) => ["tool-detail", agentId, callId] as const,
};

export interface UseToolDetailResult {
  detail: ToolCallDetail | undefined;
  loading: boolean;
  error: boolean;
}

/**
 * Resolve a tool call's expanded detail. If `streamDetail` is already present
 * it is returned directly (no fetch). Otherwise, when `expanded` is true and a
 * client + callId are available, fetch it via RPC.
 */
export function useToolCallDetail(
  agentId: string | undefined,
  callId: string | undefined,
  streamDetail: ToolCallDetail | undefined,
  expanded: boolean,
): UseToolDetailResult {
  const client = useClient();
  const shouldFetch = expanded && !streamDetail && !!client && !!agentId && !!callId;

  const query = useQuery({
    queryKey:
      agentId && callId
        ? TOOL_DETAIL_QUERY_KEYS.detail(agentId, callId)
        : ["tool-detail", "__none__"],
    queryFn: async (): Promise<ToolCallDetail | undefined> => {
      if (!client || !agentId || !callId) return undefined;
      const resp = await client.connection.request<{ payload?: { detail?: ToolCallDetail } }>(
        TOOL_DETAIL_RPC,
        { agentId, callId },
      );
      return resp.payload?.detail;
    },
    enabled: shouldFetch,
    staleTime: Infinity, // tool detail is immutable once produced
  });

  if (streamDetail) {
    return { detail: streamDetail, loading: false, error: false };
  }
  return { detail: query.data, loading: query.isLoading && shouldFetch, error: query.isError };
}
