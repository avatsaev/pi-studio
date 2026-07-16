/**
 * RightSidebar — Files/Changes/Terminals tab bar + refresh button (POC `.sidebar-right`, chat.html
 * ~line 364-374, POC_TO_APP_PLAN_UI.md §4.7; Terminals tab is new in the modern app, no POC
 * equivalent — see `TerminalsPanel.tsx`). Imported by `routes/WorkspacePage.tsx`.
 */

import { RotateCw } from "lucide-react";
import { clsx } from "clsx";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "../../components/primitives/Button.js";
import { useUiStore } from "../../stores/ui-store.js";
import { useExplorerStore } from "../../stores/explorer-store.js";
import { useTabStore } from "../../stores/tab-store.js";
import { useConnectionStore } from "../../lib/connection/connection-store.js";
import { FileExplorer } from "./FileExplorer.js";
import { ChangesPanel } from "../git/ChangesPanel.js";
import { TerminalsPanel } from "../terminal/TerminalsPanel.js";
import styles from "./RightSidebar.module.css";

export function RightSidebar() {
  const rightSidebarTab = useUiStore((s) => s.rightSidebarTab);
  const setRightSidebarTab = useUiStore((s) => s.setRightSidebarTab);
  const currentPath = useExplorerStore((s) => s.currentPath);
  // Files/Changes browse the workspace currently in view in the tab strip — the same signal
  // every tab creation site uses (§4.7 follow-up: workspace-scoped tabs).
  const activeWorkspaceCwd = useTabStore((s) => s.activeWorkspaceCwd);
  const cwd = activeWorkspaceCwd || "~";
  const client = useConnectionStore((s) => s.client);
  const queryClient = useQueryClient();

  // Fires a one-shot refresh RPC (POC `checkout_refresh_request`) — subscription lifecycle for
  // live `checkout_status_update` pushes is owned solely by `ChangesPanel`'s `useCheckoutStatus`,
  // so this button never opens a second subscription that could outlive/race the panel's. Only
  // relevant to Files/Changes — Terminals is live-pushed via `terminals_update`, nothing to poll.
  function handleRefresh() {
    void queryClient.invalidateQueries({ queryKey: ["explorer", currentPath] });
    if (client && cwd) {
      void client.connection.request("checkout_refresh_request", { cwd }).catch(() => {});
    }
  }
  return (
    <div className={styles.wrap}>
      <div className={styles.tabBar}>
        <button
          type="button"
          className={clsx(styles.tabBtn, rightSidebarTab === "files" && styles.active)}
          onClick={() => setRightSidebarTab("files")}
        >
          Files
        </button>
        <button
          type="button"
          className={clsx(styles.tabBtn, rightSidebarTab === "changes" && styles.active)}
          onClick={() => setRightSidebarTab("changes")}
        >
          Changes
        </button>
        <button
          type="button"
          className={clsx(styles.tabBtn, rightSidebarTab === "terminals" && styles.active)}
          onClick={() => setRightSidebarTab("terminals")}
        >
          Terminals
        </button>
        {rightSidebarTab !== "terminals" && (
          <Button
            size="xs"
            variant="ghost"
            iconOnly
            title="Refresh"
            className={styles.refreshBtn}
            onClick={handleRefresh}
          >
            <RotateCw size={13} />
          </Button>
        )}
      </div>
      <div className={styles.content}>
        {rightSidebarTab === "files" ? (
          <FileExplorer />
        ) : rightSidebarTab === "changes" ? (
          <ChangesPanel />
        ) : (
          <TerminalsPanel />
        )}
      </div>
    </div>
  );
}
