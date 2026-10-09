/**
 * `use-provider-models` — TanStack Query wrapper over `list_provider_models`
 * (`client.providers.listModels`, sprint-043). Read-through cached by `[provider, agentId]`: a
 * subsequent open of the model picker shows the cached list immediately (`isLoading: false`)
 * while a background refetch keeps it current, instead of re-showing a loading spinner every
 * time — mirrors `use-file-diff.ts`/`use-explorer.ts`'s existing RPC-query convention.
 *
 * `agentId` scopes the list to that agent: when it has a live process the daemon answers from it,
 * since Pi reads `models.json` once per process and a fresh discovery can offer a model that
 * agent's `set_model` rejects ("Model not found") after the file was edited.
 */

import { useQuery } from "@tanstack/react-query";
import type { ProviderModel } from "@av-pi-studio/client";
import { useConnectionStore } from "@pi-studio-ui/lib/connection/connection-store.js";
import { rpcKeys } from "@pi-studio-ui/lib/connection/rpc-keys.js";

export function useProviderModels(
  provider: string,
  agentId: string | null | undefined,
  enabled = true,
) {
  const client = useConnectionStore((s) => s.client);

  return useQuery({
    queryKey: rpcKeys.providerModels(provider, agentId),
    queryFn: async (): Promise<ProviderModel[]> => {
      if (!client) throw new Error("not connected");
      const res = await client.providers.listModels(provider, agentId ? { agentId } : undefined);
      return res.models;
    },
    enabled: Boolean(client) && Boolean(provider) && enabled,
  });
}
