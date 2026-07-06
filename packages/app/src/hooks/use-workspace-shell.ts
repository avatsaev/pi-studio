/**
 * useWorkspaceShell — aggregates all live data needed to render the workspace
 * header, sidebar, and shortcut dispatcher for a connected workspace.
 *
 * Returns props ready to be spread onto WorkspaceHeader, LeftSidebar,
 * and the shortcut registry.
 *
 * See: clean-room-scope/features/workspace-ui.md § header, § sidebar integration
 *      clean-room-scope/features/keyboard-shortcuts.md
 */

import { useMemo, useCallback } from "react";
import {
  useAgentStatus,
  useWorkspaceDescriptor,
  useActiveServerId,
  useAgentDirectory,
} from "./use-session-hooks.js";
import { useGitStatus } from "./use-explorer-hooks.js";
import { useWorkspacesQuery } from "./use-nav-hooks.js";
import { useNavigationStore } from "./use-nav-hooks.js";
import { useClient } from "./client-context.js";
import { useConnectionStatus } from "../providers/ConnectionProvider.js";
import { useWorkspaceLayoutStore } from "../store/workspace-layout-store.js";
import type { AgentStatus } from "@av-pi-studio/protocol";


// ─── Workspace header model ───────────────────────────────────────────────────

export interface WorkspaceHeaderData {
  title: string;
  subtitle?: string;
  branch?: string;
  agentStatus: AgentStatus | undefined;
  agentId: string | undefined;
  isAgentRunning: boolean;
  canStop: boolean;
  canNewMessage: boolean;
}

export function useWorkspaceHeaderData(
  serverId: string | undefined,
  workspaceId: string | undefined,
): WorkspaceHeaderData {
  const workspace = useWorkspaceDescriptor(workspaceId);
  const client = useClient();

  // Find the primary agent for this workspace (first running, else first idle)
  const agents = useAgentDirectory(workspaceId);
  const primaryAgent = useMemo(() => {
    return (
      agents.find((a) => a.status === "running") ??
      agents.find((a) => a.status === "idle") ??
      agents[0]
    );
  }, [agents]);

  const agentStatus = useAgentStatus(primaryAgent?.agentId);

  // Git status for branch name
  const cwd = workspace?.cwd ?? primaryAgent?.cwd;
  const { data: gitStatus } = useGitStatus(serverId, cwd, client);

  return {
    title: workspace?.name ?? workspaceId ?? "Workspace",
    subtitle: cwd,
    branch: gitStatus?.branch,
    agentStatus,
    agentId: primaryAgent?.agentId,
    isAgentRunning: agentStatus === "running",
    canStop: agentStatus === "running",
    canNewMessage: agentStatus === "idle" || !primaryAgent,
  };
}

// ─── Sidebar data ─────────────────────────────────────────────────────────────

export interface SidebarWorkspaceItem {
  workspaceId: string;
  name: string;
  cwd?: string;
  agentStatus?: AgentStatus;
  lastActivity?: number;
  isActive: boolean;
}

export function useSidebarData(
  routeServerId: string | undefined,
  activeWorkspaceId: string | undefined,
) {
  const client = useClient();
  const connection = useConnectionStatus();
  const navStore = useNavigationStore();
  const { data: workspaceList = [] } = useWorkspacesQuery(routeServerId, client);
  const agents = useAgentDirectory();

  // Map workspace list → sidebar items with live agent status
  const workspaceItems = useMemo((): SidebarWorkspaceItem[] => {
    return workspaceList.map((ws) => {
      // Find primary agent for this workspace
      const wsAgents = agents.filter((a) => a.workspaceId === ws.workspaceId);
      const primaryAgent =
        wsAgents.find((a) => a.status === "running") ??
        wsAgents.find((a) => a.status === "idle") ??
        wsAgents[0];

      return {
        workspaceId: ws.workspaceId,
        name: ws.displayName,
        cwd: ws.cwd,
        agentStatus: primaryAgent?.status,
        lastActivity: primaryAgent?.lastActivity,
        isActive: ws.workspaceId === activeWorkspaceId,
      };
    });
  }, [workspaceList, agents, activeWorkspaceId]);

  return {
    workspaceItems,
    connectionStatus: connection.status,
    serverId: routeServerId,
    sidebarCollapsed: navStore.sidebarCollapsed,
    setSidebarCollapsed: navStore.setSidebarCollapsed,
    workspaceSortOrder: navStore.workspaceSortOrder,
    setWorkspaceSortOrder: navStore.setWorkspaceSortOrder,
  };
}

// ─── Shortcut actions ─────────────────────────────────────────────────────────

export type WorkspaceShortcutAction =
  | { kind: "new-terminal" }
  | { kind: "close-tab"; tabId: string }
  | { kind: "focus-tab"; index: number }
  | { kind: "open-command-center" }
  | { kind: "toggle-sidebar" }
  | { kind: "stop-agent"; agentId: string };

export interface WorkspaceShortcutHandlers {
  /** Returns the action for a keyboard shortcut combo, or null if unhandled. */
  resolve(combo: string): WorkspaceShortcutAction | null;
  /** Execute a resolved action. */
  execute(action: WorkspaceShortcutAction): void;
}

export function useWorkspaceShortcuts(
  serverId: string | undefined,
  workspaceId: string | undefined,
): WorkspaceShortcutHandlers {
  const getLayoutState = useWorkspaceLayoutStore.getState;
  const navStore = useNavigationStore();
  const client = useClient();

  const ws = useWorkspaceLayoutStore((s) =>
    serverId && workspaceId ? s.workspaces[`${serverId}:${workspaceId}`] : undefined,
  );

  const resolve = useCallback(
    (combo: string): WorkspaceShortcutAction | null => {
      switch (combo) {
        case "Meta+t":
        case "ctrl+t":
          return { kind: "new-terminal" };
        case "Meta+w":
        case "ctrl+w": {
          const activeTabId =
            ws?.layout.focusedPaneId &&
            ws.layout.root.kind === "pane" &&
            ws.layout.root.focusedTabId;
          return activeTabId ? { kind: "close-tab", tabId: activeTabId } : null;
        }
        case "Meta+k":
        case "ctrl+k":
          return { kind: "open-command-center" };
        case "Meta+b":
        case "ctrl+b":
          return { kind: "toggle-sidebar" };
        default: {
          // Cmd/Ctrl+1-9 → focus tab by index
          const numMatch = combo.match(/^(?:Meta|ctrl)\+([1-9])$/);
          if (numMatch?.[1]) {
            return { kind: "focus-tab", index: parseInt(numMatch[1]) - 1 };
          }
          return null;
        }
      }
    },
    [ws],
  );

  const execute = useCallback(
    (action: WorkspaceShortcutAction) => {
      if (!serverId || !workspaceId) return;
      switch (action.kind) {
        case "new-terminal": {
          const terminalId = `term-${Date.now()}`;
          getLayoutState().openTab(serverId, workspaceId, {
            kind: "terminal",
            terminalId,
          });
          break;
        }
        case "close-tab":
          getLayoutState().closeTab(serverId, workspaceId, action.tabId);
          break;
        case "focus-tab": {
          const wsState = getLayoutState().workspaces[`${serverId}:${workspaceId}`];
          const tabId = wsState?.tabOrder[action.index];
          if (tabId) {
            getLayoutState().activateTab(serverId, workspaceId, tabId);
          }
          break;
        }
        case "open-command-center":
          // Dispatched to CommandCenter via UI store (wired in AppShell)
          document.dispatchEvent(new CustomEvent("pi:command-center:open"));
          break;
        case "toggle-sidebar":
          navStore.setSidebarCollapsed(!navStore.sidebarCollapsed);
          break;
        case "stop-agent":
          if (client) {
            void client.agent(action.agentId).interrupt().catch(() => {});
          }
          break;
      }
    },
    [serverId, workspaceId, navStore, client],
  );

  return { resolve, execute };
}
