/**
 * `use-agent-commands` — TanStack Query wrapper over `agent_list_commands_request`
 * (`client.agent(id).listCommands()`, sprint-040 web-client half). Cached exactly like
 * `use-provider-models.ts`: read-through by `["agents","commands",sessionId]`, no `staleTime`/
 * `gcTime`/`retry` override of its own, so a subsequent open of the `/` menu — including the
 * auto-open that fires on every `/` keystroke — shows the cached rows immediately
 * (`isLoading: false`) while a background refetch keeps the list current, instead of re-showing
 * a loading spinner every time.
 */

import { useQuery } from "@tanstack/react-query";
import type { AgentCommandDescriptor } from "@av-pi-studio/protocol";
import { useConnectionStore } from "@pi-studio-ui/lib/connection/connection-store.js";
import { rpcKeys } from "@pi-studio-ui/lib/connection/rpc-keys.js";
import { ensureMaterialized } from "@pi-studio-ui/stores/materialize.js";

export function useAgentCommands(sessionId: string, enabled = true) {
  const client = useConnectionStore((s) => s.client);

  return useQuery({
    queryKey: rpcKeys.agentCommands(sessionId),
    queryFn: async (): Promise<AgentCommandDescriptor[]> => {
      if (!client) throw new Error("not connected");
      // Same materialization guard `Composer.submit()`'s send branch uses — a no-op once bound.
      const agentId = await ensureMaterialized(client, sessionId);
      const { commands } = await client.agent(agentId).listCommands();
      return commands;
    },
    enabled: Boolean(client) && Boolean(sessionId) && enabled,
  });
}
