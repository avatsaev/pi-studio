/**
 * TerminalsPanel — right-sidebar Terminals tab: a persistent "New terminal" button (mints a new
 * tab against the active workspace, same `openNewTerminal` helper as `Ctrl/Cmd+T` — this IS the
 * primary discoverable entry point for creating a terminal, no POC equivalent), plus the live
 * list of every PTY running on the daemon across every workspace, with reattach (open/focus its
 * tab) and kill actions. Complements `TerminalPanel.tsx` (POC_TO_APP_PLAN_UI.md §4.6): that
 * component owns one terminal *tab*'s lifecycle; the list here is the safety net for terminals
 * that outlive their tab (see `terminal-store.ts`'s doc comment for how that can happen) or were
 * never opened as a tab in this browser session at all (created via the CLI/MCP, or from another
 * connected client). Kill on an entry WITH an open tab closes that tab instead of hitting
 * `kill_terminal_request` directly — `TabPanelHost` unmounting is what actually tears down the
 * tab's live xterm instance and stream subscription, and `TerminalPanel`'s own unmount effect
 * sends the kill RPC itself (killing the PTY without closing the tab would leave a dead,
 * unresponsive terminal tab open).
 */

import { Terminal as TerminalIcon, X, Plus } from "lucide-react";
import { Button } from "../../components/primitives/Button.js";
import { useConnectionStore } from "../../lib/connection/connection-store.js";
import { useTerminals } from "../../hooks/use-terminals.js";
import { useTerminalStore } from "../../stores/terminal-store.js";
import {
  useTabStore,
  tabIds,
  openNewTerminal,
  type Tab,
  type TerminalTabData,
} from "../../stores/tab-store.js";
import styles from "./TerminalsPanel.module.css";

export function TerminalsPanel() {
  useTerminals();
  const client = useConnectionStore((s) => s.client);
  const terminals = useTerminalStore((s) => s.terminals);
  const tabs = useTabStore((s) => s.tabs);
  const activeWorkspaceCwd = useTabStore((s) => s.activeWorkspaceCwd);
  const openTab = useTabStore((s) => s.open);
  const activateTab = useTabStore((s) => s.activate);
  const closeTab = useTabStore((s) => s.close);

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
    // If a tab for this slot is open, closing it is enough — `TerminalPanel`'s true-unmount
    // effect sends `kill_terminal_request` itself, and closing the tab is the only way to also
    // tear down its live xterm instance/subscription (killing the PTY without closing the tab
    // would leave a dead, unresponsive terminal tab open). No open tab (an orphan) → nothing to
    // unmount, so kill the PTY directly.
    const existing = findTabForSlot(slot);
    if (existing) {
      closeTab(existing.id);
      return;
    }
    if (!client) return;
    void client.connection.request("kill_terminal_request", { slot }).catch(() => {});
  }

  const newTerminalButton = (
    <Button
      variant="secondary"
      size="sm"
      leftIcon={<Plus size={14} />}
      className={styles.newTerminal}
      onClick={() => openNewTerminal(activeWorkspaceCwd || "~")}
    >
      New terminal
    </Button>
  );

  if (terminals.length === 0) {
    return (
      <div className={styles.wrap}>
        {newTerminalButton}
        <div className={styles.emptyState}>No terminals running</div>
      </div>
    );
  }

  return (
    <div className={styles.wrap}>
      {newTerminalButton}
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
    </div>
  );
}
