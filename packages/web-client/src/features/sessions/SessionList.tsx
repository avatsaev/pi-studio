/**
 * Left sidebar session list (POC `#session-list`/`renderSessions`, POC_TO_APP_PLAN_UI.md §4.3).
 * Sessions are grouped into a collapsible tree by workspace (project `cwd`): clicking a workspace
 * header toggles that workspace's collapsed state; clicking a nested session opens that session.
 */

import { FolderOpen } from "lucide-react";
import { useSessionStore } from "@pi-studio-ui/stores/session-store.js";
import { useTabStore, tabIds, openNewChat } from "@pi-studio-ui/stores/tab-store.js";
import { useConnectionStore } from "@pi-studio-ui/lib/connection/connection-store.js";
import { useUiStore } from "@pi-studio-ui/stores/ui-store.js";
import { Button } from "@pi-studio-ui/components/primitives/Button.js";
import { useHomeDir } from "@pi-studio-ui/hooks/use-home-dir.js";
import { SessionItem } from "./SessionItem.js";
import { SessionContextMenu } from "./SessionContextMenu.js";
import { WorkspaceGroupHeader } from "./WorkspaceGroupHeader.js";
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
  const setCwd = useUiStore((s) => s.setCwd);
  const openCwdPicker = useUiStore((s) => s.openCwdPicker);
  const collapsedWorkspaces = useUiStore((s) => s.collapsedWorkspaces);
  const toggleWorkspaceCollapsed = useUiStore((s) => s.toggleWorkspaceCollapsed);
  const homeDir = useHomeDir();

  function handleNewSession(targetWorkspaceCwd: string) {
    const targetCwd = normalizeCwd(targetWorkspaceCwd || "~", homeDir);
    openNewChat(targetCwd);
  }

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
    <div className={styles.wrap}>
      <div className={styles.header}>
        <h3>Workspaces</h3>
        <Button
          size="xs"
          variant="ghost"
          iconOnly
          title={status !== "open" ? "Connect to open a workspace" : "Open a workspace folder"}
          disabled={status !== "open"}
          onClick={() => openCwdPicker()}
        >
          <FolderOpen size={14} />
        </Button>
      </div>
      <div className={styles.list}>
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
                onNewSession={() => handleNewSession(group.cwd)}
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
    </div>
  );
}
