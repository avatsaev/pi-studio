import { randomUUID } from "node:crypto";

import type {
  ProjectRecord,
  ProjectRegistry,
  WorkspaceRecord,
  WorkspaceRegistry,
} from "../persistence/entity-schemas.js";
import {
  loadProjects,
  loadWorkspaces,
  saveProjects,
  saveWorkspaces,
} from "../persistence/entity-stores.js";

/**
 * Project + workspace registries with `projectKey` derivation (features/projects-workspaces.md
 * § Registries, § Project key derivation; architecture/persistence.md § Project/Workspace registry).
 *
 * A **project** groups workspaces sharing a git remote (or main repo root). A **workspace** is one
 * concrete cwd on the daemon. Both registries are JSON arrays with `archivedAt` soft-delete.
 */

export type WorkspaceKind = "local_checkout" | "worktree" | "directory";

/** Wire also accepts the legacy `checkout` kind; it maps to `local_checkout` and is never persisted. */
export function normalizeWorkspaceKind(kind: string): WorkspaceKind {
  if (kind === "checkout") return "local_checkout";
  if (kind === "local_checkout" || kind === "worktree" || kind === "directory") return kind;
  return "directory";
}

/**
 * Normalize a git remote URL to a stable `host/owner/repo` form:
 *   https://github.com/owner/repo.git  → github.com/owner/repo
 *   git@github.com:owner/repo.git      → github.com/owner/repo
 *   ssh://git@host:22/owner/repo       → host/owner/repo
 */
export function normalizeRemote(remote: string): string {
  let r = remote.trim();
  const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(r);
  // scp-like (no scheme): git@host:owner/repo(.git)
  const scp = !hasScheme && r.match(/^[^@]+@([^:]+):(.+)$/);
  if (scp) {
    r = `${scp[1]}/${scp[2]}`;
  } else {
    // strip scheme://[user@]host[:port]/
    r = r.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "");
    const at = r.indexOf("@");
    if (at !== -1) r = r.slice(at + 1);
    // drop a :port immediately after host
    r = r.replace(/^([^/]+):\d+\//, "$1/");
  }
  r = r.replace(/\.git$/i, "").replace(/\/+$/, "");
  return r.toLowerCase();
}

/** Strip trailing separators; collapse duplicate separators. Case is preserved. */
export function normalizePath(p: string): string {
  return p.replace(/[\\/]+/g, "/").replace(/\/+$/, "") || "/";
}

/**
 * Derive the project key: git remote present → `remote:<normalized remote>`; else
 * `path:<normalized rootPath>`. The key doubles as the projectId so remote-keyed ids are stable.
 */
export function deriveProjectKey(info: { remote?: string | null; rootPath: string }): string {
  if (info.remote && info.remote.trim().length > 0) {
    return `remote:${normalizeRemote(info.remote)}`;
  }
  return `path:${normalizePath(info.rootPath)}`;
}

export class WorkspaceRegistryService {
  constructor(private readonly home: string) {}

  async listProjects(): Promise<ProjectRegistry> {
    return loadProjects(this.home);
  }
  async listWorkspaces(): Promise<WorkspaceRegistry> {
    return loadWorkspaces(this.home);
  }
  async listActiveProjects(): Promise<ProjectRecord[]> {
    return (await this.listProjects()).filter((p) => !p.archivedAt);
  }
  async listActiveWorkspaces(): Promise<WorkspaceRecord[]> {
    return (await this.listWorkspaces()).filter((w) => !w.archivedAt);
  }

  /**
   * Resolve (or create) the project for a detection result. Active git projects are unique by
   * normalized `rootPath`; reuse an existing active project sharing the same key.
   */
  async resolveOrCreateProject(detection: {
    rootPath: string;
    remote?: string | null;
    kind: "git" | "non_git";
    displayName?: string;
  }): Promise<ProjectRecord> {
    const projectId = deriveProjectKey(detection);
    const projects = await this.listProjects();
    const now = new Date().toISOString();

    // Exact key match (active) — reuse.
    const byKey = projects.find((p) => p.projectId === projectId && !p.archivedAt);
    if (byKey) return byKey;

    // Active git projects unique by normalized rootPath — reuse if an active one already exists.
    const normRoot = normalizePath(detection.rootPath);
    const byRoot = projects.find(
      (p) => !p.archivedAt && p.kind === "git" && normalizePath(p.rootPath) === normRoot,
    );
    if (byRoot && detection.kind === "git") return byRoot;

    const record: ProjectRecord = {
      projectId,
      rootPath: detection.rootPath,
      kind: detection.kind,
      displayName: detection.displayName ?? defaultProjectName(projectId, detection.rootPath),
      createdAt: now,
      updatedAt: now,
      archivedAt: null,
    };
    projects.push(record);
    await saveProjects(this.home, projects);
    return record;
  }

  /** Resolve (or create) a workspace for a cwd under a project. Reuse an existing active record. */
  async resolveOrCreateWorkspace(args: {
    projectId: string;
    cwd: string;
    kind: WorkspaceKind | string;
    displayName?: string;
  }): Promise<{ workspace: WorkspaceRecord; created: boolean }> {
    const kind = normalizeWorkspaceKind(String(args.kind));
    const workspaces = await this.listWorkspaces();
    const now = new Date().toISOString();
    const normCwd = normalizePath(args.cwd);

    const existing = workspaces.find((w) => !w.archivedAt && normalizePath(w.cwd) === normCwd);
    if (existing) return { workspace: existing, created: false };

    const record: WorkspaceRecord = {
      workspaceId: randomUUID(),
      projectId: args.projectId,
      cwd: args.cwd,
      kind,
      displayName: args.displayName ?? defaultWorkspaceName(args.cwd),
      createdAt: now,
      updatedAt: now,
      archivedAt: null,
    };
    workspaces.push(record);
    await saveWorkspaces(this.home, workspaces);
    return { workspace: record, created: true };
  }

  /** Soft-delete a workspace by id. Returns the archived record, or null if not found/active. */
  async archiveWorkspace(workspaceId: string): Promise<WorkspaceRecord | null> {
    const workspaces = await this.listWorkspaces();
    const target = workspaces.find((w) => w.workspaceId === workspaceId);
    if (!target || target.archivedAt) return target ?? null;
    const now = new Date().toISOString();
    target.archivedAt = now;
    target.updatedAt = now;
    await saveWorkspaces(this.home, workspaces);
    return target;
  }
}

function defaultProjectName(projectId: string, rootPath: string): string {
  if (projectId.startsWith("remote:")) {
    const parts = projectId.slice("remote:".length).split("/");
    return parts[parts.length - 1] || projectId;
  }
  return basenameOf(rootPath);
}

function defaultWorkspaceName(cwd: string): string {
  return basenameOf(cwd);
}

function basenameOf(p: string): string {
  const norm = normalizePath(p);
  const parts = norm.split("/");
  return parts[parts.length - 1] || norm;
}
