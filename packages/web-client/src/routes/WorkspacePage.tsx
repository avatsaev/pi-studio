/**
 * WorkspacePage — the 3-column shell (POC `.main`: sidebar-left / center / sidebar-right,
 * POC_TO_APP_PLAN_UI.md §3). Feature panels are mounted here once each lands. Either sidebar can
 * be hidden via the Toolbar's panel toggles (`ui-store.ts` `leftSidebarCollapsed`/
 * `rightSidebarCollapsed`) — collapsed just means the `aside` isn't rendered, so `TabPanelHost`'s
 * `.center` column simply grows to fill the freed width. Each visible sidebar is resizable via a
 * `ResizeHandle` on its inner edge, dragging `ui-store.ts`'s `leftSidebarWidth`/
 * `rightSidebarWidth` (clamped to `[MIN_SIDEBAR_WIDTH, MAX_SIDEBAR_WIDTH]`) through the
 * delta-based `resizeLeftSidebar`/`resizeRightSidebar` actions.
 */

import { Toolbar } from "../features/connection/Toolbar.js";
import { SessionList } from "../features/sessions/SessionList.js";
import { TabStrip } from "../features/workspace/TabStrip.js";
import { TabPanelHost } from "../features/workspace/TabPanelHost.js";
import { RightSidebar } from "../features/files/RightSidebar.js";
import { OpenWorkspaceDialog } from "../features/workspace-picker/OpenWorkspaceDialog.js";
import { ResizeHandle } from "../components/primitives/ResizeHandle.js";
import { useUiStore } from "../stores/ui-store.js";
import styles from "./WorkspacePage.module.css";

export function WorkspacePage() {
  const leftSidebarCollapsed = useUiStore((s) => s.leftSidebarCollapsed);
  const rightSidebarCollapsed = useUiStore((s) => s.rightSidebarCollapsed);
  const leftSidebarWidth = useUiStore((s) => s.leftSidebarWidth);
  const rightSidebarWidth = useUiStore((s) => s.rightSidebarWidth);
  const resizeLeftSidebar = useUiStore((s) => s.resizeLeftSidebar);
  const resizeRightSidebar = useUiStore((s) => s.resizeRightSidebar);

  return (
    <div className={styles.shell}>
      <Toolbar />
      <div className={styles.main}>
        {!leftSidebarCollapsed && (
          <aside className={styles.sidebarLeft} style={{ width: leftSidebarWidth }}>
            <SessionList />
            <ResizeHandle side="left" className={styles.leftHandle} onResize={resizeLeftSidebar} />
          </aside>
        )}
        <div className={styles.center}>
          <TabStrip />
          <TabPanelHost />
        </div>
        {!rightSidebarCollapsed && (
          <aside className={styles.sidebarRight} style={{ width: rightSidebarWidth }}>
            <ResizeHandle side="right" className={styles.rightHandle} onResize={resizeRightSidebar} />
            <RightSidebar />
          </aside>
        )}
      </div>
      <OpenWorkspaceDialog />
    </div>
  );
}
