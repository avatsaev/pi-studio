/**
 * useWorkspaceRouteState — resolves workspace from URL params and validates
 * against the connected host + session store.
 *
 * Returns a gate state (loading / missing / ready) and the workspace descriptor
 * so the workspace screen can decide what to render.
 *
 * See: clean-room-scope/features/workspace-ui.md § route state
 *      clean-room-scope/architecture/client-app-runtime.md § workspace routing
 */

import { useEffect, useMemo } from "react";
import { useWorkspaceDescriptor, useActiveServerId } from "./use-session-hooks.js";
import { useWorkspacesQuery, type WorkspaceRecord } from "./use-nav-hooks.js";
import { useClient } from "./client-context.js";
import { useConnectionStatus } from "../providers/ConnectionProvider.js";
import { resolveWorkspaceRouteGate, type WorkspaceRouteGateInput } from "../workspace/route-gating.js";
import {
  useWorkspaceLayoutStore,
  useWorkspaceTabState,
} from "../store/workspace-layout-store.js";
import { useSessionStore, type WorkspaceDescriptor } from "../store/session-store.js";
import type { WorkspaceGateState } from "../workspace/route-gating.js";

/** Maps the daemon's `WorkspaceRecord` RPC shape into the session store's `WorkspaceDescriptor`. */
export function toWorkspaceDescriptor(record: WorkspaceRecord): WorkspaceDescriptor {
  return {
    workspaceId: record.workspaceId,
    name: record.displayName,
    cwd: record.cwd,
    // Dev-mode 1:1 synthesis (see dev-bootstrap.ts): workspaceId === agentId.
    agentIds: [record.workspaceId],
    projectId: record.projectId,
  };
}

export interface WorkspaceRouteState {
  gate: WorkspaceGateState;
  /** The exact gate input used to resolve `gate` — pass through to any other
   * gate consumer (e.g. `WorkspaceScreen`) instead of reconstructing it, to
   * avoid double/divergent gate resolution. */
  gateInput: WorkspaceRouteGateInput;
  /** Present when gate.state === "ready". */
  workspace: WorkspaceDescriptor | undefined;
  /** Whether the tab layout has been hydrated for this workspace. */
  tabsHydrated: boolean;
}

/**
 * Resolve the workspace route state for a given serverId + workspaceId (from URL params).
 * Handles: no-host, reconnecting, not-found, directory-missing, and ready states.
 */
export function useWorkspaceRouteState(
  routeServerId: string | undefined,
  workspaceId: string | undefined,
): WorkspaceRouteState {
  const client = useClient();
  const connection = useConnectionStatus();
  const activeServerId = useActiveServerId();

  // Fetch workspace list so we know what's available on the daemon
  const { data: workspaceList, isLoading: workspacesLoading } = useWorkspacesQuery(
    routeServerId,
    client,
  );

  // Sync fetched workspace records into the session store so
  // `useWorkspaceDescriptor` (read below) can resolve them by id.
  const upsertWorkspace = useSessionStore((s) => s.upsertWorkspace);
  useEffect(() => {
    if (!workspaceList) return;
    for (const record of workspaceList) {
      upsertWorkspace(toWorkspaceDescriptor(record));
    }
  }, [workspaceList, upsertWorkspace]);

  // Check if this workspace is in the session store
  const workspaceDescriptor = useWorkspaceDescriptor(workspaceId);

  // Check if tab layout is hydrated
  const tabState = useWorkspaceTabState(routeServerId, workspaceId);

  const knownWorkspaceIds = useMemo(
    () => (workspaceList ?? []).map((ws) => ws.workspaceId),
    [workspaceList],
  );

  const gate = useMemo((): WorkspaceGateState => {
    if (!routeServerId || !workspaceId) {
      return { state: "missing", actions: ["dismiss-missing-workspace", "manage-host"] };
    }

    const gateInput: WorkspaceRouteGateInput = {
      routeServerId,
      activeServerId: activeServerId ?? undefined,
      workspaceId,
      hostOnline: connection.status === "connected",
      workspacesHydrated: !workspacesLoading,
      tabsHydrated: tabState?.hydrated ?? false,
      knownWorkspaceIds,
    };

    return resolveWorkspaceRouteGate(gateInput);
  }, [
    routeServerId,
    workspaceId,
    activeServerId,
    connection.status,
    workspacesLoading,
    tabState?.hydrated,
    knownWorkspaceIds,
  ]);

  const gateInput: WorkspaceRouteGateInput = {
    routeServerId: routeServerId ?? "",
    activeServerId: activeServerId ?? undefined,
    workspaceId: workspaceId ?? "",
    hostOnline: connection.status === "connected",
    workspacesHydrated: !workspacesLoading,
    tabsHydrated: tabState?.hydrated ?? false,
    knownWorkspaceIds,
  };

  return {
    gate,
    gateInput,
    workspace: workspaceDescriptor,
    tabsHydrated: tabState?.hydrated ?? false,
  };
}
