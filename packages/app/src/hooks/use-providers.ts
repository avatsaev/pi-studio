/**
 * useProviders — React Query hook returning the available agent providers
 * (+ their modes) from the daemon `list_providers` RPC, parsed via the pure
 * `provider-picker` logic. Falls back to a static default list (pi + mock)
 * when the daemon has no provider RPC or the call fails, so the new-agent
 * picker is never empty.
 *
 * clean-room-scope/features/agent-providers.md
 * clean-room-scope/sprints/sprint-030-integration-gap-closure/task-002
 */

import { useQuery } from "@tanstack/react-query";
import { parseProviderList, FALLBACK_PROVIDERS, type ProviderOption } from "../screens/provider-picker.js";

export interface ProvidersClient {
  providers: { listProviders(): Promise<unknown> };
}

export function useProviders(client: ProvidersClient | null) {
  return useQuery({
    queryKey: ["providers"],
    queryFn: async (): Promise<ProviderOption[]> => {
      if (!client) return FALLBACK_PROVIDERS;
      try {
        const raw = await client.providers.listProviders();
        return parseProviderList(raw);
      } catch {
        // Daemon without a provider RPC (e.g. dev bootstrap pre-030) — degrade
        // gracefully rather than blocking agent creation.
        return FALLBACK_PROVIDERS;
      }
    },
    staleTime: 60_000,
  });
}
