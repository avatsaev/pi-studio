/**
 * `use-provider-models` — TanStack Query wrapper over `list_provider_models`
 * (`client.providers.listModels`, sprint-043). Read-through cached by `[provider]`: a
 * subsequent open of the model picker shows the cached list immediately (`isLoading: false`)
 * while a background refetch keeps it current, instead of re-showing a loading spinner every
 * time — mirrors `use-file-diff.ts`/`use-explorer.ts`'s existing RPC-query convention.
 */

import { useQuery } from "@tanstack/react-query";
import type { ProviderModel } from "@av-pi-studio/client";
import { useConnectionStore } from "@pi-studio-ui/lib/connection/connection-store.js";
import { rpcKeys } from "@pi-studio-ui/lib/connection/rpc-keys.js";

export function useProviderModels(provider: string, enabled = true) {
  const client = useConnectionStore((s) => s.client);

  return useQuery({
    queryKey: rpcKeys.providerModels(provider),
    queryFn: async (): Promise<ProviderModel[]> => {
      if (!client) throw new Error("not connected");
      const res = await client.providers.listModels(provider);
      return res.models;
    },
    enabled: Boolean(client) && Boolean(provider) && enabled,
  });
}
