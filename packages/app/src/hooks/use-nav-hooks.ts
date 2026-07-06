/**
 * Schedules, projects, workspaces & navigation hooks — sprint-023 / task-004
 *
 * React Query hooks for schedule CRUD, project/workspace data, and a Zustand
 * navigation store for sidebar state that persists to KV.
 *
 * See: clean-room-scope/features/schedules-heartbeats.md
 *      clean-room-scope/features/projects-workspaces.md
 *      clean-room-scope/features/app-navigation-screens.md
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { useShallow } from "zustand/react/shallow";
import { useSessionStore as useSessionStoreForHosts } from "../store/session-store.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ScheduleRun {
  id: string;
  scheduledFor?: number;
  startedAt?: number;
  endedAt?: number;
  status: "running" | "succeeded" | "failed";
  output?: string;
  error?: string;
}

export interface ScheduleTarget {
  type: "new_agent" | "agent";
  agentId?: string;
  config?: Record<string, unknown>;
}

export interface Schedule {
  id: string;
  title: string;
  enabled: boolean;
  cron?: string;
  everyMs?: number;
  timezone?: string;
  prompt: string;
  target: ScheduleTarget;
  nextRunAt?: number;
  lastRunAt?: number;
  pausedAt?: number;
  expiresAt?: number;
  maxRuns?: number;
  runs: ScheduleRun[];
  createdAt: number;
  updatedAt: number;
}

export interface ProjectRecord {
  projectId: string;
  rootPath: string;
  kind: "git" | "non_git";
  displayName: string;
  remoteUrl?: string;
  defaultBranch?: string;
  archivedAt?: number;
  createdAt: number;
  updatedAt: number;
}

export interface WorkspaceRecord {
  workspaceId: string;
  projectId: string;
  cwd: string;
  kind: "local_checkout" | "directory" | "worktree";
  displayName: string;
  archivedAt?: number;
  agentStatus?: "idle" | "running" | "error";
  createdAt: number;
  updatedAt: number;
}

// ─── Query keys ──────────────────────────────────────────────────────────────

export const NAV_QUERY_KEYS = {
  schedules: (serverId: string) => ["schedules", serverId] as const,
  scheduleLogs: (serverId: string, scheduleId: string) =>
    ["schedules", "logs", serverId, scheduleId] as const,
  projects: () => ["projects"] as const,
  workspaces: (serverId: string) => ["workspaces", serverId] as const,
} as const;

// ─── Client type ─────────────────────────────────────────────────────────────

interface NavClient {
  connection: {
    request<T>(type: string, payload?: unknown): Promise<T>;
  };
}

// ─── Schedule hooks ───────────────────────────────────────────────────────────

export function useSchedulesQuery(serverId: string | undefined, client: NavClient | null) {
  return useQuery({
    queryKey: serverId ? NAV_QUERY_KEYS.schedules(serverId) : ["schedules", "__none__"],
    queryFn: async (): Promise<Schedule[]> => {
      if (!client || !serverId) return [];
      const resp = await client.connection.request<{ schedules?: Schedule[] }>(
        "schedule_list_request",
        { serverId },
      );
      return resp.schedules ?? [];
    },
    enabled: !!client && !!serverId,
    staleTime: 15_000,
  });
}

export function useScheduleHistory(
  serverId: string | undefined,
  scheduleId: string | undefined,
  client: NavClient | null,
) {
  return useQuery({
    queryKey:
      serverId && scheduleId
        ? NAV_QUERY_KEYS.scheduleLogs(serverId, scheduleId)
        : ["schedules", "logs", "__none__"],
    queryFn: async (): Promise<ScheduleRun[]> => {
      if (!client || !serverId || !scheduleId) return [];
      const resp = await client.connection.request<{ runs?: ScheduleRun[] }>(
        "schedule_logs_request",
        { serverId, scheduleId },
      );
      return resp.runs ?? [];
    },
    enabled: !!client && !!serverId && !!scheduleId,
    staleTime: 30_000,
  });
}

// ─── Schedule mutations ───────────────────────────────────────────────────────

export interface CreateScheduleInput {
  serverId: string;
  title: string;
  prompt: string;
  target: ScheduleTarget;
  cron?: string;
  everyMs?: number;
  timezone?: string;
  maxRuns?: number;
  expiresAt?: number;
}

export interface UpdateScheduleInput {
  serverId: string;
  scheduleId: string;
  patch: Partial<Pick<Schedule, "title" | "prompt" | "cron" | "everyMs" | "timezone" | "maxRuns" | "expiresAt">>;
}

export function useScheduleMutation(client: NavClient | null) {
  const qc = useQueryClient();

  const invalidate = (serverId: string) =>
    qc.invalidateQueries({ queryKey: NAV_QUERY_KEYS.schedules(serverId) });

  const create = useMutation({
    mutationFn: async (input: CreateScheduleInput) => {
      if (!client) throw new Error("No client");
      return client.connection.request<Schedule>("create_schedule_request", input);
    },
    onSuccess: (_data, input) => invalidate(input.serverId),
  });

  const update = useMutation({
    mutationFn: async (input: UpdateScheduleInput) => {
      if (!client) throw new Error("No client");
      return client.connection.request("update_schedule_request", input);
    },
    onSuccess: (_data, input) => invalidate(input.serverId),
  });

  const remove = useMutation({
    mutationFn: async (input: { serverId: string; scheduleId: string }) => {
      if (!client) throw new Error("No client");
      return client.connection.request("delete_schedule_request", input);
    },
    onSuccess: (_data, input) => invalidate(input.serverId),
  });

  const toggle = useMutation({
    mutationFn: async (input: { serverId: string; scheduleId: string; enabled: boolean }) => {
      if (!client) throw new Error("No client");
      const type = input.enabled ? "resume_schedule_request" : "pause_schedule_request";
      return client.connection.request(type, input);
    },
    onSuccess: (_data, input) => invalidate(input.serverId),
  });

  const runNow = useMutation({
    mutationFn: async (input: { serverId: string; scheduleId: string }) => {
      if (!client) throw new Error("No client");
      return client.connection.request("schedule_run_once_request", input);
    },
    onSuccess: (_data, input) => invalidate(input.serverId),
  });

  return { create, update, remove, toggle, runNow };
}

// ─── Project hooks ────────────────────────────────────────────────────────────

export function useProjectsQuery(client: NavClient | null) {
  return useQuery({
    queryKey: NAV_QUERY_KEYS.projects(),
    queryFn: async (): Promise<ProjectRecord[]> => {
      if (!client) return [];
      const resp = await client.connection.request<{ projects?: ProjectRecord[] }>(
        "list_projects_request",
      );
      return resp.projects ?? [];
    },
    enabled: !!client,
    staleTime: 30_000,
  });
}

export function useWorkspacesQuery(serverId: string | undefined, client: NavClient | null) {
  return useQuery({
    queryKey: serverId ? NAV_QUERY_KEYS.workspaces(serverId) : ["workspaces", "__none__"],
    queryFn: async (): Promise<WorkspaceRecord[]> => {
      if (!client || !serverId) return [];
      const resp = await client.connection.request<{ workspaces?: WorkspaceRecord[] }>(
        "list_workspaces_request",
        { serverId },
      );
      return resp.workspaces ?? [];
    },
    enabled: !!client && !!serverId,
    staleTime: 15_000,
  });
}

export function useProjectMutation(client: NavClient | null) {
  const qc = useQueryClient();

  const register = useMutation({
    mutationFn: async (input: { path: string }) => {
      if (!client) throw new Error("No client");
      return client.connection.request<ProjectRecord>("open_project_request", input);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: NAV_QUERY_KEYS.projects() }),
  });

  const unregister = useMutation({
    mutationFn: async (input: { projectId: string }) => {
      if (!client) throw new Error("No client");
      return client.connection.request("archive_workspace_request", input);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: NAV_QUERY_KEYS.projects() }),
  });

  return { register, unregister };
}

// ─── Navigation store (Zustand + persist) ────────────────────────────────────

export interface CollapsedSections {
  projects: boolean;
  schedules: boolean;
  recent: boolean;
}

export interface NavigationState {
  /** Currently active workspace id (driven by route, but persisted for restore). */
  activeWorkspaceId: string | null;
  /** Whether the sidebar is collapsed (icon-only mode). */
  sidebarCollapsed: boolean;
  /** Which sidebar sections are collapsed by the user. */
  collapsedSections: CollapsedSections;
  /** Sort order for workspace list. */
  workspaceSortOrder: "recent" | "alpha";
  /** Last visited workspace per host (serverId → workspaceId). */
  lastWorkspaceByHost: Record<string, string>;
}

export interface NavigationActions {
  setActiveWorkspace(workspaceId: string | null): void;
  setSidebarCollapsed(collapsed: boolean): void;
  toggleSection(section: keyof CollapsedSections): void;
  setWorkspaceSortOrder(order: "recent" | "alpha"): void;
  setLastWorkspace(serverId: string, workspaceId: string): void;
}

export type NavigationStore = NavigationState & NavigationActions;

const DEFAULT_NAV_STATE: NavigationState = {
  activeWorkspaceId: null,
  sidebarCollapsed: false,
  collapsedSections: { projects: false, schedules: true, recent: false },
  workspaceSortOrder: "recent",
  lastWorkspaceByHost: {},
};

export const useNavigationStore = create<NavigationStore>()(
  persist(
    (set) => ({
      ...DEFAULT_NAV_STATE,

      setActiveWorkspace(workspaceId) {
        set({ activeWorkspaceId: workspaceId });
      },

      setSidebarCollapsed(collapsed) {
        set({ sidebarCollapsed: collapsed });
      },

      toggleSection(section) {
        set((s) => ({
          collapsedSections: {
            ...s.collapsedSections,
            [section]: !s.collapsedSections[section],
          },
        }));
      },

      setWorkspaceSortOrder(order) {
        set({ workspaceSortOrder: order });
      },

      setLastWorkspace(serverId, workspaceId) {
        set((s) => ({
          lastWorkspaceByHost: { ...s.lastWorkspaceByHost, [serverId]: workspaceId },
        }));
      },
    }),
    {
      name: "pi-studio-nav",
      storage: createJSONStorage(() => {
        // Safe localStorage wrapper (falls back to memory in test / SSR)
        try {
          return localStorage;
        } catch {
          const mem = new Map<string, string>();
          return {
            getItem: (k) => mem.get(k) ?? null,
            setItem: (k, v) => mem.set(k, v),
            removeItem: (k) => mem.delete(k),
          };
        }
      }),
      partialize: (s) => ({
        sidebarCollapsed: s.sidebarCollapsed,
        collapsedSections: s.collapsedSections,
        workspaceSortOrder: s.workspaceSortOrder,
        lastWorkspaceByHost: s.lastWorkspaceByHost,
        // NOTE: activeWorkspaceId is NOT persisted — it is driven by the route.
      }),
    },
  ),
);

// ─── Host connection hook (thin wrapper over session store) ──────────────────

export type HostConnectionStatus = "connected" | "connecting" | "disconnected" | "error";

export interface HostConnectionInfo {
  serverId: string;
  status: HostConnectionStatus;
  version?: string;
}

/**
 * Returns per-host connection info aggregated from the session store servers map.
 */
export function useHostConnections(): HostConnectionInfo[] {
  return useSessionStoreForHosts(
    useShallow((s) =>
      Object.values(s.servers).map((srv) => ({
        serverId: srv.serverId,
        status: "connected" as HostConnectionStatus,
        version: srv.version,
      })),
    ),
  );
}
