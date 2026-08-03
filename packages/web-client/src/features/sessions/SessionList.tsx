/**
 * Left sidebar session list (POC `#session-list`/`renderSessions`, POC_TO_APP_PLAN_UI.md §4.3).
 * Sessions are grouped into a collapsible tree by workspace (project `cwd`): clicking a workspace
 * header toggles that workspace's collapsed state; clicking a nested session opens that session.
 * New conversation / Delete workspace live behind the header's "⋮" button
 * (`WorkspaceContextMenu.tsx`) rather than always-visible icon buttons.
 */

import type { DragEvent } from "react";
import { FolderOpen } from "lucide-react";
import { useSessionStore } from "@pi-studio-ui/stores/session-store.js";
import { useTabStore } from "@pi-studio-ui/stores/tab-store.js";
import { useConnectionStore } from "@pi-studio-ui/lib/connection/connection-store.js";
import { useUiStore } from "@pi-studio-ui/stores/ui-store.js";
import { Button } from "@pi-studio-ui/components/primitives/Button.js";
import { Panel } from "@pi-studio-ui/components/primitives/Panel.js";
import { EmptyState } from "@pi-studio-ui/components/primitives/EmptyState.js";
import { useHomeDir } from "@pi-studio-ui/hooks/use-home-dir.js";
import { SessionItem } from "./SessionItem.js";
import { SessionContextMenu } from "./SessionContextMenu.js";
import { WorkspaceGroupHeader } from "./WorkspaceGroupHeader.js";
import { WorkspaceContextMenu } from "./WorkspaceContextMenu.js";
import { groupSessionsByWorkspace, workspaceLabel } from "./workspace-grouping.js";
import { openChatTab } from "./open-chat-tab.js";
import { EXTERNAL_DRAG_MIME } from "@pi-studio-ui/features/workspace/external-drag.js";
import styles from "./SessionList.module.css";

export function SessionList() {
  const order = useSessionStore((s) => s.order);
  const sessions = useSessionStore((s) => s.sessions);
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const activate = useSessionStore((s) => s.activate);
  const activeWorkspaceCwd = useTabStore((s) => s.activeWorkspaceCwd);
  const status = useConnectionStore((s) => s.status);
  const openSessionMenu = useUiStore((s) => s.openSessionMenu);
  const openWorkspaceMenu = useUiStore((s) => s.openWorkspaceMenu);
  const setCwd = useUiStore((s) => s.setCwd);
  const openCwdPicker = useUiStore((s) => s.openCwdPicker);
  const collapsedWorkspaces = useUiStore((s) => s.collapsedWorkspaces);
  const toggleWorkspaceCollapsed = useUiStore((s) => s.toggleWorkspaceCollapsed);
  const homeDir = useHomeDir();

  function handleSelect(sessionId: string) {
    activate(sessionId);
    const session = sessions[sessionId];
    if (session?.cwd) setCwd(session.cwd);
    if (session) openChatTab(session, homeDir);
  }

  /**
   * Only a row belonging to the workspace currently in view is draggable into a pane. Panes belong to
   * one workspace's layout, and mid-drag a browser exposes `dataTransfer.types` but not its values —
   * so a pane could not tell a foreign chat from a local one in time to refuse the preview. Withholding
   * the MIME at the source keeps "the preview is always the outcome" true: a foreign row simply
   * produces no drop target, instead of previewing a split that would then be rejected.
   */
  function handleDragStart(sessionId: string, groupCwd: string, e: DragEvent) {
    if (groupCwd !== activeWorkspaceCwd) return;
    e.dataTransfer.setData(EXTERNAL_DRAG_MIME.chat, sessionId);
    e.dataTransfer.effectAllowed = "copy";
  }

  const groups = groupSessionsByWorkspace(order, sessions, homeDir);
  return (
    <Panel>
      <div className={styles.header}>
        <h3>Workspaces</h3>
        <Button
          size="xs"
          variant="ghost"
          iconOnly
          className={styles.openBtn}
          title={status !== "open" ? "Connect to open a workspace" : "Open a workspace folder"}
          disabled={status !== "open"}
          onClick={() => openCwdPicker()}
        >
          <FolderOpen size={13} />
        </Button>
      </div>
      <div className={styles.list}>
        {groups.length === 0 && (
          <EmptyState style={{ padding: "var(--pi-spacing-12) var(--pi-spacing-10)" }}>
            {status !== "open" ? "Not connected" : "No workspaces — open a folder to start"}
          </EmptyState>
        )}
        {groups.map((group) => {
          const collapsed = collapsedWorkspaces.has(group.cwd);
          return (
            <div key={group.cwd} className={styles.workspaceGroup}>
              <WorkspaceGroupHeader
                label={workspaceLabel(group.cwd)}
                cwd={group.cwd}
                sessionCount={group.sessions.length}
                collapsed={collapsed}
                onToggleCollapsed={() => toggleWorkspaceCollapsed(group.cwd)}
                onOpenMenu={(x, y) => openWorkspaceMenu(group.cwd, x, y)}
              />
              {!collapsed && (
                <div className={styles.workspaceSessions}>
                  {group.sessions.map((session) => (
                    <SessionItem
                      key={session.id}
                      session={session}
                      active={session.id === activeSessionId}
                      draggable={group.cwd === activeWorkspaceCwd}
                      onSelect={() => handleSelect(session.id)}
                      onOpenMenu={(x, y) => openSessionMenu(session.id, x, y)}
                      onDragStartRow={(e) => handleDragStart(session.id, group.cwd, e)}
                    />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <SessionContextMenu />
      <WorkspaceContextMenu />
    </Panel>
  );
}
