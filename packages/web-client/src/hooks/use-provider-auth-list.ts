/**
 * `use-provider-auth-list` — TanStack Query wrapper over `listProviderAuth()` (sprint-065),
 * shared by `ModelProvidersPanel` (task-003, the settings list) and the chat empty-state
 * onboarding nudge (task-006) under one query key (`rpcKeys.providerAuthList()`). A login or
 * logout in either surface invalidates the single cached query, so both update together with no
 * reload and no second fetch path — mirrors `use-provider-models.ts`/`use-file-diff.ts`'s
 * existing RPC-query convention.
 */

import { useQuery } from "@tanstack/react-query";
import type { ProviderAuthInfo } from "@av-pi-studio/protocol";
import { useConnectionStore } from "@pi-studio-ui/lib/connection/connection-store.js";
import { rpcKeys } from "@pi-studio-ui/lib/connection/rpc-keys.js";

export function useProviderAuthList(enabled = true) {
  const client = useConnectionStore((s) => s.client);

  return useQuery<ProviderAuthInfo[]>({
    queryKey: rpcKeys.providerAuthList(),
    queryFn: () => {
      if (!client) throw new Error("not connected");
      return client.listProviderAuth();
    },
    enabled: Boolean(client) && enabled,
  });
}
