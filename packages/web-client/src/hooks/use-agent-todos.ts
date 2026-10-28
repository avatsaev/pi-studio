/**
 * Agent todos boot: one `agent_todos_update` subscription per open connection, and a refetch of
 * every tracked agent each time a connection opens (the daemon restarts `seq` at 1 on restart, so
 * the store resets seq tracking first). A daemon without the `agentTodos` capability gets zero
 * requests and an emptied store. Other statuses keep the snapshots: the next open resets them.
 *
 * Mount once in `app.tsx`'s `Boot`, next to `useViewerSettingsBoot()`.
 */

import { useEffect } from "react";
import { useConnectionStore } from "@pi-studio-ui/lib/connection/connection-store.js";
import { useAgentTodosStore } from "@pi-studio-ui/features/chat/todos/agent-todos-store.js";

export function useAgentTodosBoot(): void {
  const status = useConnectionStore((s) => s.status);
  const client = useConnectionStore((s) => s.client);

  useEffect(() => {
    if (status !== "open" || !client) return;
    const store = useAgentTodosStore.getState();
    if (!client.hasAgentTodosCapability()) {
      store.clear();
      return;
    }
    const off = client.onAgentTodosUpdate((snapshot) => {
      useAgentTodosStore.getState().applyUpdate(snapshot);
    });
    void store.refetchTracked();
    return off;
  }, [status, client]);
}
