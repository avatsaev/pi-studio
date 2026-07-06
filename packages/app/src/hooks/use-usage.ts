/**
 * Usage hooks — per-agent live token/cost usage (composer footer) and
 * provider account usage (balances / rate-limit windows).
 *
 * clean-room-scope/features/composer-ui.md § Provider usage
 * clean-room-scope/features/provider-usage.md
 */

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSessionStore } from "../store/session-store.js";
import {
  formatUsageLabel,
  usageBreakdown,
  type UsageBreakdownRow,
} from "../composer/usage-format.js";

// ─── Per-agent live usage ──────────────────────────────────────────────────

export interface AgentUsageView {
  /** Compact footer label, or undefined when there's nothing to show. */
  label: string | undefined;
  /** Detailed rows for the breakdown popover. */
  breakdown: UsageBreakdownRow[];
}

/** Live token/cost usage for the composer footer, updated via `agent_usage`. */
export function useAgentUsage(agentId: string | undefined, modelLabel?: string): AgentUsageView {
  const usage = useSessionStore((s) => (agentId ? s.agents[agentId]?.usage : undefined));
  return useMemo(
    () => ({ label: formatUsageLabel(usage, modelLabel), breakdown: usageBreakdown(usage) }),
    [usage, modelLabel],
  );
}

// ─── Provider account usage (balances / windows) ────────────────────────────

export interface ProviderUsageEntry {
  provider: string;
  status: "available" | "unavailable" | "error";
  sourceLabel?: string;
  fetchedAt: string;
  windows: import("../composer/usage-format.js").ProviderUsageWindow[];
  balances?: unknown[];
  details?: unknown[];
}

export const USAGE_QUERY_KEYS = {
  providerUsage: (serverId: string) => ["provider-usage", serverId] as const,
} as const;

/** True when the connected host advertises the `providerUsageList` feature. */
export function useProviderUsageSupported(serverId: string | undefined): boolean {
  return useSessionStore((s) => {
    if (!serverId) return false;
    const features = s.servers[serverId]?.["features"] as Record<string, unknown> | undefined;
    return features?.["providerUsageList"] === true;
  });
}

/**
 * Fetch provider account usage. Enabled only when connected AND the host
 * advertises `providerUsageList`; 5-minute stale time; manual refresh only
 * (no refetch on focus/reconnect).
 */
export function useProviderUsage(
  serverId: string | undefined,
  client: { connection: { request<T>(type: string, payload?: unknown): Promise<T> } } | null,
  supported: boolean,
) {
  return useQuery({
    queryKey: serverId ? USAGE_QUERY_KEYS.providerUsage(serverId) : ["provider-usage", "__none__"],
    queryFn: async (): Promise<ProviderUsageEntry[]> => {
      if (!client || !serverId) return [];
      const resp = await client.connection.request<{ payload?: { providers?: ProviderUsageEntry[] } }>(
        "provider_usage_list_request",
        { serverId },
      );
      return resp.payload?.providers ?? [];
    },
    enabled: !!client && !!serverId && supported,
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
}
