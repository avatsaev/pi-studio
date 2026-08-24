/**
 * `use-thinking-levels` — TanStack Query wrapper over `agent_thinking_levels_request`
 * (`client.agent(id).listThinkingLevels()`, sprint-070). Keyed `[agentId, model]` so a model
 * change — which can clamp the level list — refetches automatically without manual
 * invalidation. Live sessions only: drafts answer from the cached model catalogue
 * (`thinking-level-source.ts`), never this query — the caller (`Composer.tsx`) gates `enabled`
 * on `userMessageCount > 0` so a never-spawned draft never issues it. `retry: false` because a
 * `requireSession` rejection is deterministic for a given `[agentId, model]` key: retrying a
 * request that can never succeed is pure waste (and briefly leaves the menu stuck retrying
 * instead of showing the catalogue fallback).
 */

import { useQuery } from "@tanstack/react-query";
import { useConnectionStore } from "@pi-studio-ui/lib/connection/connection-store.js";
import { rpcKeys } from "@pi-studio-ui/lib/connection/rpc-keys.js";

export function useThinkingLevels(
  agentId: string | null | undefined,
  model: string | undefined,
  enabled = true,
) {
  const client = useConnectionStore((s) => s.client);

  return useQuery({
    queryKey: rpcKeys.thinkingLevels(agentId ?? "", model),
    queryFn: async (): Promise<string[]> => {
      if (!client || !agentId) throw new Error("not connected");
      const res = await client.agent(agentId).listThinkingLevels();
      return res.levels;
    },
    enabled: Boolean(client) && Boolean(agentId) && enabled,
    retry: false,
  });
}
