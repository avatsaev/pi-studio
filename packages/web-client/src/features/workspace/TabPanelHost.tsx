/**
 * TabPanelHost — mounts one panel per open tab via `panel-registry`, keeps inactive panels
 * mounted but hidden (`display:none`), preserving scroll/terminal state across tab switches
 * exactly like the POC's DOM-persisted panels (POC_TO_APP_PLAN_UI.md §4.2), but through React
 * reconciliation instead of `data-tab-panel` querying. This now spans workspace switches too
 * (§4.7 follow-up: workspace-scoped tabs) — ALL tabs across every workspace stay mounted; only
 * the strip/empty-state visibility is workspace-scoped, so switching workspaces never tears down
 * a live terminal or loses scroll position in another workspace's tabs.
 */

import { Suspense } from "react";
import { clsx } from "clsx";
import { Spinner } from "../../components/primitives/Spinner.js";
import { useTabStore } from "../../stores/tab-store.js";
import { PANEL_BY_KIND } from "./panel-registry.js";
import styles from "./TabPanelHost.module.css";

export function TabPanelHost() {
  const tabs = useTabStore((s) => s.tabs);
  const activeTabId = useTabStore((s) => s.activeTabId);
  const activeWorkspaceCwd = useTabStore((s) => s.activeWorkspaceCwd);
  const hasTabsInWorkspace = tabs.some((t) => t.workspaceCwd === activeWorkspaceCwd);

  if (!hasTabsInWorkspace) {
    return (
      <div className={styles.area}>
        <div className={styles.empty}>No open tabs in this workspace</div>
      </div>
    );
  }

  return (
    <div className={styles.area}>
      {tabs.map((tab) => {
        const Panel = PANEL_BY_KIND[tab.kind];
        return (
          <div
            key={tab.id}
            className={clsx(styles.panel, tab.id === activeTabId && styles.active)}
          >
            <Suspense fallback={<Spinner size="md" />}>
              <Panel tab={tab} />
            </Suspense>
          </div>
        );
      })}
    </div>
  );
}
