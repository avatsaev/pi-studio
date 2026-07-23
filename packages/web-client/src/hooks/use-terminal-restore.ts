/**
 * Terminal restore — on a fresh `open` connection, fetches every terminal currently running on
 * the daemon (`list_terminals_request`) and reopens a tab for each one, mirroring
 * `use-session-restore.ts`'s one-shot restore pattern but for terminals instead of chat sessions.
 * A terminal can outlive its tab (a daemon restart losing the tab's in-memory link, a dev-mode
 * double-mount race losing the created slot before it's persisted onto the tab, or simply a
 * terminal created outside this UI — the CLI/MCP, or another connected client) and this is what
 * makes it reappear automatically as an ordinary closable tab instead of leaking silently or
 * needing a separate "orphaned terminals" management view. `TerminalPanel`'s slot-creation effect
 * only fires `create_terminal_request` when a tab's `data.slot` is still `null`, so opening a tab
 * with the terminal's already-known slot here just subscribes to its existing stream (reattach),
 * never spawns a second PTY.
 */

import { useEffect, useRef } from "react";
import { useConnectionStore } from "@pi-studio-ui/lib/connection/connection-store.js";
import { useTabStore, tabIds } from "@pi-studio-ui/stores/tab-store.js";
import { normalizeCwd } from "@pi-studio-ui/features/sessions/workspace-grouping.js";
import { resolveHome } from "@pi-studio-ui/stores/explorer-store.js";

interface TerminalRestoreEntry {
  slot: number;
  name: string;
  cwd?: string;
  closed: boolean;
}

interface TerminalsListResponse {
  terminals?: TerminalRestoreEntry[];
}

export function useTerminalRestore(): void {
  const client = useConnectionStore((s) => s.client);
  const status = useConnectionStore((s) => s.status);
  const restoredRef = useRef(false);

  useEffect(() => {
    if (status !== "open" || !client) return;
    if (restoredRef.current) return; // one restore per connection lifetime
    restoredRef.current = true;

    void (async () => {
      let terminals: TerminalRestoreEntry[] = [];
      try {
        const res = await client.connection.request<TerminalsListResponse>(
          "list_terminals_request",
          {},
        );
        terminals = res.terminals ?? [];
      } catch {
        terminals = [];
      }
      if (terminals.length === 0) return;

      const homeDir = await resolveHome(client).catch(() => null);
      const openTab = useTabStore.getState().open;
      for (const entry of terminals) {
        if (entry.closed) continue;
        const workspaceCwd = normalizeCwd(entry.cwd || "~", homeDir);
        openTab({
          id: tabIds.terminal(entry.slot),
          kind: "terminal",
          label: entry.name,
          closable: true,
          data: { slot: entry.slot, cwd: workspaceCwd },
          workspaceCwd,
        });
      }
    })();
  }, [status, client]);
}
