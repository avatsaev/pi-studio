import { readdir } from "node:fs/promises";
import { basename, join } from "node:path";

import type { ProjectRecord, WorkspaceRecord } from "../persistence/entity-schemas.js";
import type { Session } from "../ws/session.js";
import type { HandlerRegistry } from "../ws/router.js";
import { detectGit, type GitRunner } from "./git-detect.js";
import { type WorkspaceKind, WorkspaceRegistryService } from "./workspace-registry.js";

/**
 * Open-project flow + workspace RPCs (features/projects-workspaces.md § RPCs/operations,
 * § Open project). Detects git, resolves/creates the project + workspace, and broadcasts
 * `workspace_update`.
 */

export interface OpenProjectResult {
  project: ProjectRecord;
  workspace: WorkspaceRecord;
  created: boolean;
  branch: string | null;
}

export interface OpenProjectDeps {
  home: string;
  broadcast: (sessions: Iterable<Session>, message: unknown) => void;
  gitRunner?: GitRunner;
  registry?: WorkspaceRegistryService;
}

export class OpenProjectService {
  private readonly registry: WorkspaceRegistryService;

  constructor(private readonly deps: OpenProjectDeps) {
    this.registry = deps.registry ?? new WorkspaceRegistryService(deps.home);
  }

  registerHandlers(registry: HandlerRegistry, getActiveSessions: () => Iterable<Session>): void {
    registry.register("open_project_request", async (ctx) => {
      const path = String(ctx.message.path ?? "");
      const result = await this.openProject(path, getActiveSessions);
      return {
        type: "open_project_response",
        project: result.project,
        workspace: result.workspace,
        branch: result.branch,
      };
    });

    registry.register("archive_workspace_request", async (ctx) => {
      const workspaceId = String(ctx.message.workspaceId ?? "");
      const archived = await this.registry.archiveWorkspace(workspaceId);
      if (archived) this.broadcastWorkspace(getActiveSessions(), archived);
      return { type: "archive_workspace_response", workspaceId, ok: Boolean(archived) };
    });

    registry.register("workspace_clear_attention", (ctx) => {
      const workspaceId = String(ctx.message.workspaceId ?? "");
      this.deps.broadcast(getActiveSessions(), {
        type: "workspace_update",
        workspaceId,
        attentionCleared: true,
      });
      return undefined; // fire-and-forget message
    });

    registry.register("directory_suggestions_request", async (ctx) => {
      const base = String(ctx.message.path ?? ctx.message.base ?? "");
      const suggestions = await listDirectories(base);
      return { type: "directory_suggestions_response", base, suggestions };
    });

    registry.register("workspace_setup_status_request", (ctx) => ({
      type: "workspace_setup_status_response",
      workspaceId: String(ctx.message.workspaceId ?? ""),
      // No active setup run unless a worktree service reports progress (task-003).
      status: "idle",
    }));

    registry.register("project_icon_request", (ctx) => ({
      type: "project_icon_response",
      projectId: String(ctx.message.projectId ?? ""),
      icon: null, // resolution mechanism is TODO(verify) in the scope.
    }));
  }

  /**
   * Open a project at `path`: detect git, resolve/create the Project by `projectKey`, resolve/create
   * the workspace for this cwd, then broadcast `workspace_update`.
   */
  async openProject(
    path: string,
    getActiveSessions: () => Iterable<Session> = () => [],
  ): Promise<OpenProjectResult> {
    const detection = await detectGit(path, this.deps.gitRunner);
    const project = await this.registry.resolveOrCreateProject({
      rootPath: detection.isGit ? detection.rootPath : path,
      remote: detection.remote,
      kind: detection.isGit ? "git" : "non_git",
    });

    // A cwd at the repo root is a local_checkout; a non-git directory is a `directory`.
    const kind: WorkspaceKind = detection.isGit ? "local_checkout" : "directory";
    const { workspace, created } = await this.registry.resolveOrCreateWorkspace({
      projectId: project.projectId,
      cwd: path,
      kind,
    });

    this.broadcastWorkspace(getActiveSessions(), workspace, project, detection.branch);
    return { project, workspace, created, branch: detection.branch };
  }

  private broadcastWorkspace(
    sessions: Iterable<Session>,
    workspace: WorkspaceRecord,
    project?: ProjectRecord,
    branch?: string | null,
  ): void {
    this.deps.broadcast(sessions, {
      type: "workspace_update",
      workspaceId: workspace.workspaceId,
      projectId: workspace.projectId,
      cwd: workspace.cwd,
      kind: workspace.kind,
      displayName: workspace.displayName,
      archivedAt: workspace.archivedAt ?? null,
      ...(project ? { projectName: project.displayName, projectKind: project.kind } : {}),
      ...(branch !== undefined ? { branch } : {}),
    });
  }
}

/** List immediate subdirectory names of `base` (best-effort; empty on error). */
async function listDirectories(base: string): Promise<string[]> {
  if (!base) return [];
  try {
    const entries = await readdir(base, { withFileTypes: true });
    return entries
      .filter((e) => e.isDirectory() && !e.name.startsWith("."))
      .map((e) => join(base, e.name))
      .toSorted((a, b) => basename(a).localeCompare(basename(b)));
  } catch {
    return [];
  }
}
