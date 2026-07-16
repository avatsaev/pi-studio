/**
 * TerminalsPanel — right-sidebar Terminals tab: live list of every PTY running on the daemon,
 * across every workspace, with reattach (open/focus its tab) and kill actions. Complements
 * `TerminalPanel.tsx` (POC_TO_APP_PLAN_UI.md §4.6): that component owns one terminal *tab*'s
 * lifecycle; this one is the safety net for terminals that outlive their tab (see
 * `terminal-store.ts`'s doc comment for how that can happen) or were never opened as a tab in
 * this browser session at all (created via the CLI/MCP, or from another connected client).
 */

import { Terminal as TerminalIcon, X } from "lucide-react";
import { useConnectionStore } from "../../lib/connection/connection-store.js";
import { useTerminals } from "../../hooks/use-terminals.js";
import { useTerminalStore } from "../../stores/terminal-store.js";
import { useTabStore, tabIds, type Tab, type TerminalTabData } from "../../stores/tab-store.js";
import styles from "./TerminalsPanel.module.css";

export function TerminalsPanel() {
  useTerminals();
  const client = useConnectionStore((s) => s.client);
  const terminals = useTerminalStore((s) => s.terminals);
  const tabs = useTabStore((s) => s.tabs);
  const openTab = useTabStore((s) => s.open);
  const activateTab = useTabStore((s) => s.activate);

  // A terminal tab's `id` is NOT `tabIds.terminal(slot)` in general — `use-shortcuts.ts`'s
  // Ctrl/Cmd+T mints `term-new-<counter>` up front (before the slot exists) and never renames
  // the tab once `TerminalPanel` learns its real slot, only `data.slot` is updated. So the only
  // reliable way to find "the tab for this slot" is scanning by `data.slot`, not by id.
  function findTabForSlot(slot: number): Tab | undefined {
    return tabs.find((t) => t.kind === "terminal" && (t.data as TerminalTabData).slot === slot);
  }

  function handleReattach(slot: number, name: string, cwd: string | undefined) {
    const existing = findTabForSlot(slot);
    if (existing) {
      activateTab(existing.id);
      return;
    }
    // No tab anywhere points at this slot yet — open a fresh one around the EXISTING slot.
    // `TerminalPanel`'s slot-creation effect only fires when `data.slot` is null, so it reuses
    // this slot and just subscribes instead of spawning a new PTY.
    const workspaceCwd = cwd || "~";
    openTab({
      id: tabIds.terminal(slot),
      kind: "terminal",
      label: name,
      closable: true,
      data: { slot, cwd: workspaceCwd },
      workspaceCwd,
    });
  }

  function handleKill(slot: number) {
    if (!client) return;
    void client.connection.request("kill_terminal_request", { slot }).catch(() => {});
  }

  if (terminals.length === 0) {
    return <div className={styles.emptyState}>No terminals running</div>;
  }

  return (
    <div className={styles.list}>
      <div className={styles.summary}>
        {terminals.length} terminal{terminals.length === 1 ? "" : "s"} running
      </div>
      {terminals.map((entry) => {
        const isOpen = findTabForSlot(entry.slot) !== undefined;
        return (
          <div key={entry.slot} className={styles.item}>
            <button
              type="button"
              className={styles.reattach}
              onClick={() => handleReattach(entry.slot, entry.name, entry.cwd)}
              title={entry.cwd}
            >
              <TerminalIcon size={13} className={styles.icon} />
              <span className={styles.name}>{entry.name}</span>
              {isOpen && <span className={styles.openBadge}>open</span>}
            </button>
            <button
              type="button"
              className={styles.kill}
              onClick={() => handleKill(entry.slot)}
              title="Kill terminal"
            >
              <X size={13} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
