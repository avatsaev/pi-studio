/**
 * WorkspacePage — the 3-column shell (POC `.main`: sidebar-left / center / sidebar-right,
 * POC_TO_APP_PLAN_UI.md §3). Feature panels are mounted here once each lands. Either sidebar can
 * be hidden via the ConnectionBar's panel toggles (`ui-store.ts` `leftSidebarCollapsed`/
 * `rightSidebarCollapsed`) — collapsed just means the `aside` isn't rendered, so `TabPanelHost`'s
 * `.center` column simply grows to fill the freed width. Each visible sidebar is resizable via a
 * `ResizeHandle` on its inner edge, dragging `ui-store.ts`'s `leftSidebarWidth`/
 * `rightSidebarWidth` (clamped to `[MIN_SIDEBAR_WIDTH, MAX_SIDEBAR_WIDTH]`) through the
 * delta-based `resizeLeftSidebar`/`resizeRightSidebar` actions.
 */

import { ConnectionBar } from "@pi-studio-ui/features/connection/ConnectionBar.js";
import { SessionList } from "@pi-studio-ui/features/sessions/SessionList.js";
// No TabStrip here since sprint-049: strips are per pane and live inside TabPanelHost, positioned
// across the top of each pane's rect (features/workspace/pane-layout-view.ts).
import { TabPanelHost } from "@pi-studio-ui/features/workspace/TabPanelHost.js";
import { RightSidebar } from "@pi-studio-ui/features/files/RightSidebar.js";
import { StatusBar } from "@pi-studio-ui/features/workspace/StatusBar.js";
import { OpenWorkspaceDialog } from "@pi-studio-ui/features/workspace-picker/OpenWorkspaceDialog.js";
import { Announcer } from "@pi-studio-ui/components/primitives/Announcer.js";
import { ResizeHandle } from "@pi-studio-ui/components/primitives/ResizeHandle.js";
import { ToastViewport } from "@pi-studio-ui/components/primitives/ToastViewport.js";
import { useUiStore } from "@pi-studio-ui/stores/ui-store.js";
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
      <ConnectionBar />
      <div className={styles.main}>
        {!leftSidebarCollapsed && (
          <aside className={styles.sidebarLeft} style={{ width: leftSidebarWidth }}>
            <SessionList />
            <ResizeHandle side="left" className={styles.leftHandle} onResize={resizeLeftSidebar} />
          </aside>
        )}
        <div className={styles.center}>
          <TabPanelHost />
        </div>
        {!rightSidebarCollapsed && (
          <aside className={styles.sidebarRight} style={{ width: rightSidebarWidth }}>
            <ResizeHandle
              side="right"
              className={styles.rightHandle}
              onResize={resizeRightSidebar}
            />
            <RightSidebar />
          </aside>
        )}
      </div>
      <StatusBar />
      <OpenWorkspaceDialog />
      <ToastViewport />
      <Announcer />
    </div>
  );
}
