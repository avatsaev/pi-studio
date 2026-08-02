/**
 * Left sidebar session list (POC `#session-list`/`renderSessions`, POC_TO_APP_PLAN_UI.md §4.3).
 * Sessions are grouped into a collapsible tree by workspace (project `cwd`): clicking a workspace
 * header toggles that workspace's collapsed state; clicking a nested session opens that session.
 * New conversation / Delete workspace live behind the header's "⋮" button
 * (`WorkspaceContextMenu.tsx`) rather than always-visible icon buttons.
 */

import { FolderOpen } from "lucide-react";
import { useSessionStore } from "@pi-studio-ui/stores/session-store.js";
import { useTabStore, tabIds } from "@pi-studio-ui/stores/tab-store.js";
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
import { groupSessionsByWorkspace, normalizeCwd, workspaceLabel } from "./workspace-grouping.js";
import styles from "./SessionList.module.css";

export function SessionList() {
  const order = useSessionStore((s) => s.order);
  const sessions = useSessionStore((s) => s.sessions);
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const activate = useSessionStore((s) => s.activate);
  const openTab = useTabStore((s) => s.open);
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
    const targetCwd = normalizeCwd(session?.cwd || "~", homeDir);
    if (session?.cwd) setCwd(session.cwd);
    openTab({
      id: tabIds.chat(sessionId),
      kind: "chat",
      label: session?.title ?? "Chat",
      closable: true,
      data: { sessionId },
      workspaceCwd: targetCwd,
    });
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
                      onSelect={() => handleSelect(session.id)}
                      onOpenMenu={(x, y) => openSessionMenu(session.id, x, y)}
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
