/**
 * Global keymap: Ctrl/Cmd+T new terminal, Ctrl/Cmd+W close active tab, Esc close overlays
 * (POC `document.addEventListener("keydown", …)`, POC_TO_APP_PLAN_UI.md §4.8).
 */

import { useEffect } from "react";
import { useTabStore, openNewTerminal, closeTab } from "@pi-studio-ui/stores/tab-store.js";
import { useUiStore } from "@pi-studio-ui/stores/ui-store.js";
import { useToastStore } from "@pi-studio-ui/stores/toast-store.js";

export function useShortcuts(): void {
  useEffect(() => {
    function onKeyDown(ev: KeyboardEvent) {
      const ui = useUiStore.getState();

      if (ev.key === "Escape") {
        ui.closeCwdPicker();
        ui.closeSessionMenu();
        // A Radix `Dialog`/`AlertDialog` (`role="dialog"`/`"alertdialog"`) handles its own Escape
        // via `DismissableLayer`'s capture-phase listener, which runs before this bubble-phase one
        // and does not call `stopPropagation()` — so without this guard, dismissing a dialog and
        // dismissing the top toast would both fire on the same keystroke. § 11/task-005's
        // "with a dialog open, Esc closes the dialog first" means the dialog gets this keystroke
        // exclusively; the toast waits for the next one. Cards (sprint-068's `AskCard.tsx`) need no
        // such guard here — they call the real native `stopPropagation()` on their own Escape
        // handler, which prevents this listener from observing the event at all.
        if (!document.querySelector('[role="dialog"], [role="alertdialog"]')) {
          useToastStore.getState().dismissTop();
        }
        return;
      }

      const mod = ev.ctrlKey || ev.metaKey;
      if (mod && ev.key.toLowerCase() === "t") {
        ev.preventDefault();
        // Captured synchronously here, not inside the terminal's mount effect — a rapid
        // workspace-switch-then-Ctrl+T must never race the async `create_terminal_request`.
        openNewTerminal(useTabStore.getState().activeWorkspaceCwd || "~");
        return;
      }

      if (mod && ev.key.toLowerCase() === "w") {
        const { activeTabId, tabs } = useTabStore.getState();
        if (!activeTabId) return;
        const tab = tabs.find((t) => t.id === activeTabId);
        if (tab?.closable !== false) {
          ev.preventDefault();
          closeTab(activeTabId);
        }
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);
}
