/**
 * Terminal restore — on a fresh `open` connection, fetches every terminal currently running on
 * the daemon (`list_terminals_request`) and reopens a tab for each one it should surface,
 * mirroring `use-session-restore.ts`'s one-shot restore pattern but for terminals instead of chat
 * sessions. A terminal can outlive its tab (a daemon restart losing the tab's in-memory link, a
 * dev-mode double-mount race losing the created slot before it's persisted onto the tab, or simply
 * a terminal created outside this UI — the CLI/MCP, or another connected client) and this is what
 * makes it reappear automatically as an ordinary closable tab instead of leaking silently or
 * needing a separate "orphaned terminals" management view. `TerminalPanel`'s slot-creation effect
 * only fires `create_terminal_request` when a tab's `data.slot` is still `null`, so opening a tab
 * with the terminal's already-known slot here just subscribes to its existing stream (reattach),
 * never spawns a second PTY.
 *
 * **"Reopen every terminal" only holds for a workspace with no persisted pane-layout record.** For
 * one that has one (the ordinary case once it has been split), this is claim-driven like chat
 * restore: a terminal only gets a tab automatically if some pane there is actually waiting for it
 * (`terminal:<slot>` in that workspace's `pendingPlacement`) — checked per workspace, so one
 * workspace's record never suppresses a terminal belonging to an unrelated, never-split one. An
 * unrelated terminal left running elsewhere used to force a tab open regardless, landing in
 * whichever pane happened to be focused and — before `layout-store.ts#claimPaneFor`'s restore-time
 * guard existed — silently replacing a chat a claim had *just* placed there a moment earlier in the
 * same restore pass. Orphaned-terminal surfacing is deliberately narrower now: real for a workspace
 * nothing has ever split (nothing to conflict with), suppressed once that workspace has an
 * arrangement a stray terminal has no claim on.
 *
 * This is also one of the two halves of the pane-layout hydration settle point
 * (`layout-store.markHydrationSource`): being one-shot per connection is what makes "initial
 * hydration complete" a well-defined moment.
 */

import { useEffect, useRef } from "react";
import type { PiStudioClient } from "@av-pi-studio/client";
import { useConnectionStore } from "@pi-studio-ui/lib/connection/connection-store.js";
import { useTabStore, tabIds } from "@pi-studio-ui/stores/tab-store.js";
import { normalizeCwd } from "@pi-studio-ui/features/sessions/workspace-grouping.js";
import { resolveHome } from "@pi-studio-ui/stores/explorer-store.js";
import { useLayoutStore } from "@pi-studio-ui/stores/layout-store.js";

interface TerminalRestoreEntry {
  slot: number;
  name: string;
  cwd?: string;
  closed: boolean;
}

interface TerminalsListResponse {
  terminals?: TerminalRestoreEntry[];
}

/**
 * The one-shot restore body plus its hydration signal. Exported for direct unit testing — this
 * project's vitest config runs `.test.ts` under a plain Node environment (no DOM), so the hook
 * itself is verified by smoke test while this is driven directly.
 */
export async function runTerminalRestore(client: PiStudioClient): Promise<void> {
  try {
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

    // A workspace's own persisted record is authoritative once one exists: only reopen a terminal
    // there that some pane is actually waiting for. A DIFFERENT workspace having a record must not
    // suppress this one — it restores independently below — and a workspace with no record at all
    // has nothing for a stray terminal to conflict with, so it still surfaces every terminal there,
    // matching the original "never leak a terminal silently" guarantee. `layouts` is snapshotted
    // once, before this loop's own `openTab` calls can start creating fresh entries for workspaces
    // that had none — a later terminal in that same NEW workspace must not see its sibling's arrival
    // as if it were a pre-existing record and get wrongly suppressed.
    const layouts = useLayoutStore.getState().layouts;
    const claimed = claimedTerminalIdentities();

    const homeDir = await resolveHome(client).catch(() => null);
    const openTab = useTabStore.getState().open;
    for (const entry of terminals) {
      if (entry.closed) continue;
      const workspaceCwd = normalizeCwd(entry.cwd || "~", homeDir);
      if (layouts[workspaceCwd] !== undefined && !claimed.has(`terminal:${entry.slot}`)) continue;
      openTab({
        id: tabIds.terminal(entry.slot),
        kind: "terminal",
        label: entry.name,
        closable: true,
        data: { slot: entry.slot, cwd: workspaceCwd },
        workspaceCwd,
      });
    }
  } finally {
    // Reported on every path — zero terminals and a failed request included, or a persisted pane
    // would wait forever for a claim that never comes.
    useLayoutStore.getState().markHydrationSource("terminals");
  }
}

/** The `terminal:` identities persisted panes are still waiting for, across every workspace — mirrors
 * `use-session-restore.ts`'s `claimedChatIdentities`. */
function claimedTerminalIdentities(): Set<string> {
  const claimed = new Set<string>();
  for (const layout of Object.values(useLayoutStore.getState().layouts)) {
    for (const identity of Object.keys(layout.pendingPlacement)) {
      if (identity.startsWith("terminal:")) claimed.add(identity);
    }
  }
  return claimed;
}

export function useTerminalRestore(): void {
  const client = useConnectionStore((s) => s.client);
  const status = useConnectionStore((s) => s.status);
  const restoredRef = useRef(false);

  useEffect(() => {
    if (status !== "open" || !client) return;
    if (restoredRef.current) return; // one restore per connection lifetime
    restoredRef.current = true;
    void runTerminalRestore(client);
  }, [status, client]);
}
