// Workspace route gating.
// clean-room-scope/features/workspace-ui.md § Route gating

export type WorkspaceRouteGateInput = {
  routeServerId: string;
  activeServerId?: string;
  workspaceId: string;
  hostOnline: boolean;
  workspacesHydrated: boolean;
  tabsHydrated: boolean;
  knownWorkspaceIds: readonly string[];
  workspaceDirExists?: boolean;
};

export type WorkspaceGateState =
  | { state: "ready" }
  | { state: "splash" }
  | { state: "reconnecting"; actions: readonly ["retry-host", "manage-host"] }
  | { state: "unreachable"; actions: readonly ["retry-host", "manage-host"] }
  | { state: "loading" }
  | { state: "missing"; actions: readonly ["dismiss-missing-workspace", "manage-host"] }
  | { state: "foreign"; redirect: string }
  | { state: "directory-missing" };

export function resolveWorkspaceRouteGate(input: WorkspaceRouteGateInput): WorkspaceGateState {
  if (input.activeServerId && input.activeServerId !== input.routeServerId) return { state: "foreign", redirect: `/h/${encodeURIComponent(input.activeServerId)}` };
  const known = input.knownWorkspaceIds.includes(input.workspaceId);
  if (!input.hostOnline) return known ? { state: "reconnecting", actions: ["retry-host", "manage-host"] } : { state: "unreachable", actions: ["retry-host", "manage-host"] };
  if (!input.workspacesHydrated) return { state: "loading" };
  if (!known) return { state: "missing", actions: ["dismiss-missing-workspace", "manage-host"] };
  if (input.workspaceDirExists === false) return { state: "directory-missing" };
  if (!input.tabsHydrated) return { state: "splash" };
  return { state: "ready" };
}
