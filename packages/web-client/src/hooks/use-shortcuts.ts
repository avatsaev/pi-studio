/**
 * Global keymap: Ctrl/Cmd+T new terminal, Ctrl/Cmd+W close active tab, Esc close overlays
 * (POC `document.addEventListener("keydown", …)`, POC_TO_APP_PLAN_UI.md §4.8).
 */

import { useEffect } from "react";
import { useTabStore, openNewTerminal } from "../stores/tab-store.js";
import { useUiStore } from "../stores/ui-store.js";

export function useShortcuts(): void {
  useEffect(() => {
    function onKeyDown(ev: KeyboardEvent) {
      const ui = useUiStore.getState();

      if (ev.key === "Escape") {
        ui.closeCwdPicker();
        ui.closeSessionMenu();
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
        const { activeTabId, tabs, close } = useTabStore.getState();
        if (!activeTabId) return;
        const tab = tabs.find((t) => t.id === activeTabId);
        if (tab?.closable !== false) {
          ev.preventDefault();
          close(activeTabId);
        }
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);
}
