// Projects list + per-project settings view models.
// app-navigation-screens.md § Projects screens, architecture/config.md, structured-generation.md

import type { HostRuntimeSnapshot } from "../runtime/host-runtime.js";

export type ProjectListItem = {
  projectKey: string;
  name: string;
  hostServerId: string;
  archived?: boolean;
};

export type ProjectsListInput = {
  loading: boolean;
  projects: readonly ProjectListItem[];
  hostErrors?: readonly { serverId: string; message: string }[];
};

export type ProjectsListState =
  | { kind: "loading" }
  | { kind: "empty"; errors: readonly { serverId: string; message: string }[] }
  | { kind: "list"; projects: ProjectListItem[]; errors: readonly { serverId: string; message: string }[] };

export function resolveProjectsListState(input: ProjectsListInput): ProjectsListState {
  const errors = input.hostErrors ?? [];
  if (input.loading) return { kind: "loading" };
  const active = input.projects.filter((p) => !p.archived);
  if (active.length === 0) return { kind: "empty", errors };
  return { kind: "list", projects: [...active].sort((a, b) => a.name.localeCompare(b.name)), errors };
}

export type EditableProjectCopy = {
  projectKey: string;
  hostServerId: string;
  revision: number;
  config: ProjectConfig;
};

export type ProjectConfig = {
  worktree?: { setup?: string | string[]; teardown?: string | string[] };
  scripts?: Record<string, string>;
  services?: Record<string, { command: string; port?: number }>;
  metadataPrompts?: {
    agentTitle?: string;
    branchName?: string;
    commitMessage?: string;
    pullRequest?: string;
  };
};

export function resolveEditableProjectCopy(
  copies: readonly EditableProjectCopy[],
  connectedHosts: readonly HostRuntimeSnapshot[],
): EditableProjectCopy | null {
  const onlineIds = new Set(connectedHosts.filter((h) => h.status === "online").map((h) => h.serverId ?? h.profile.serverId));
  return copies.find((copy) => onlineIds.has(copy.hostServerId)) ?? null;
}

export type ConfigPatch = {
  revision: number;
  config: ProjectConfig;
};

export function editMetadataPrompt(copy: EditableProjectCopy, field: keyof NonNullable<ProjectConfig["metadataPrompts"]>, value: string): ConfigPatch {
  return {
    revision: copy.revision,
    config: {
      ...copy.config,
      metadataPrompts: {
        ...copy.config.metadataPrompts,
        [field]: value,
      },
    },
  };
}

export function editWorktreeLifecycle(copy: EditableProjectCopy, field: "setup" | "teardown", value: string | string[]): ConfigPatch {
  return {
    revision: copy.revision,
    config: {
      ...copy.config,
      worktree: {
        ...copy.config.worktree,
        [field]: value,
      },
    },
  };
}
