/**
 * Terminal exit watch — listens for `terminals_update` (a JSON push, broadcast to **every** active
 * session unconditionally whenever a terminal is created/renamed/killed/self-exits/starts a
 * workspace script, **or is resized to a genuinely new size** (sprint-053/task-003 and task-007,
 * `packages/server/src/terminal/terminal-rpc.ts`) and marks any open terminal tab whose slot has
 * disappeared from the daemon's live inventory as `exited`.
 * Follows the same local-interface-plus-type-guard convention as `checkout_status_update` /
 * `file_changed` (root AGENTS.md § Protocol overview) — no protocol-package schema exists for this
 * push family, and none is needed: it is a per-connection JSON broadcast, not a per-path
 * subscription.
 *
 * `TerminalManager.list()` (daemon) only ever returns *live* entries — `onExit` deletes a
 * terminal's map entry the instant it fires, before the broadcast that reports the removal — so
 * there is no `closed: true` flag to look for on this side; a slot's absence from `terminals` IS
 * the exit signal.
 *
 * Reconciles only tabs whose `data.slot` is already known (non-null). The create broadcast lands
 * *before* `create_terminal_response` resolves (`terminal-rpc.ts`'s create handler broadcasts,
 * then returns), so this client's own freshly created tab has no slot yet when the very first
 * `terminals_update` naming it arrives — treating that gap as an exit would mark a brand-new
 * terminal exited before it ever ran. Once `TerminalPanel` records the slot, later updates
 * reconcile it normally.
 *
 * `TerminalsUpdateMessage.terminals[].cols`/`.rows` (task-007) are consumed by a separate,
 * per-panel listener in `TerminalPanel.tsx` — resize belief (`believedSizeRef`) is deliberately a
 * component-local ref, not tab-store state, so it cannot be reconciled from this global hook. That
 * listener reuses this file's `TerminalsUpdateMessage` type and `isTerminalsUpdate` guard rather
 * than declaring a parallel one, per this file's original design note to coordinate, not duplicate.
 */

import { useEffect } from "react";
import { useConnectionStore } from "@pi-studio-ui/lib/connection/connection-store.js";
import { useTabStore, type TerminalTabData } from "@pi-studio-ui/stores/tab-store.js";

export interface TerminalsUpdateMessage {
  type: "terminals_update";
  terminals: Array<{ slot: number; cols?: number; rows?: number }>;
}

export function isTerminalsUpdate(message: unknown): message is TerminalsUpdateMessage {
  return (
    typeof message === "object" &&
    message !== null &&
    (message as { type?: unknown }).type === "terminals_update" &&
    Array.isArray((message as { terminals?: unknown }).terminals)
  );
}

/**
 * Marks every open terminal tab whose `data.slot` is a known, non-null number NOT present in
 * `liveSlots` as exited. Exported for direct unit testing — this project's vitest config runs
 * `.test.ts` under a plain Node environment (no DOM), so the hook itself is verified by smoke
 * test while this is driven directly (mirrors `use-terminal-restore.ts`'s `runTerminalRestore`).
 */
export function reconcileLiveTerminals(liveSlots: Set<number>): void {
  const { tabs, updateData } = useTabStore.getState();
  for (const tab of tabs) {
    if (tab.kind !== "terminal") continue;
    const data = tab.data as TerminalTabData;
    if (data.slot === null || data.exited) continue; // unknown-slot or already-exited: skip
    if (!liveSlots.has(data.slot)) updateData(tab.id, { exited: true });
  }
}

export function useTerminalExitWatch(): void {
  const client = useConnectionStore((s) => s.client);

  useEffect(() => {
    if (!client) return;
    return client.connection.onSessionMessage((msg) => {
      const message: unknown = msg;
      if (!isTerminalsUpdate(message)) return;
      reconcileLiveTerminals(new Set(message.terminals.map((t) => t.slot)));
    });
  }, [client]);
}
