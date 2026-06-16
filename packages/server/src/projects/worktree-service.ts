import { createHash } from "node:crypto";
import { join } from "node:path";

import type { WorkspaceRecord } from "../persistence/entity-schemas.js";
import type { Session } from "../ws/session.js";
import type { HandlerRegistry } from "../ws/router.js";
import { defaultGitRunner, type GitRunner } from "./git-detect.js";
import { normalizePath, WorkspaceRegistryService } from "./workspace-registry.js";

/**
 * Pi-Studio-managed git worktree service (features/worktrees.md § Operations, § Behavior,
 * § Lifecycle config; architecture/agent-lifecycle.md § Archive). Handles create/setup, archive/
 * teardown, and the `autoArchive`+`worktree` coupling.
 */

/** Agent label naming the worktree workspace it lives in (for auto-archive coupling). */
export const WORKTREE_WORKSPACE_ID_LABEL = "pi-studio.worktree-workspace-id";
/** Agent label flagging auto-archive after the first terminal turn. */
export const AUTO_ARCHIVE_LABEL = "pi-studio.auto-archive";

const MAX_WORKTREE_NAME = 60;

export interface CreateWorktreeIntent {
  /** Source checkout (main repo root) the worktree branches from. */
  projectRoot: string;
  /** Owning project id. */
  projectId: string;
  /** Requested worktree/branch name (slugged; may be generated if absent). */
  name?: string;
  /** Existing branch to check out (mutually exclusive with new-branch generation). */
  branch?: string;
  /** Base ref for a newly created branch. */
  baseRef?: string;
  /** Prompt used to generate a branch name when neither `name` nor `branch` is provided. */
  generatePrompt?: string;
}

export interface WorktreeDescriptor {
  workspace: WorkspaceRecord;
  name: string;
  branch: string;
  path: string;
  setupOk: boolean;
}

export type CommandRunResult = { code: number; stdout: string; stderr: string };
export type CommandRunner = (
  command: string,
  opts: { cwd: string; env: Record<string, string> },
) => Promise<CommandRunResult>;

export interface AgentLike {
  id: string;
  cwd: string;
  labels: Record<string, string>;
}

export interface WorktreeServiceDeps {
  home: string;
  registry?: WorkspaceRegistryService;
  broadcast: (sessions: Iterable<Session>, message: unknown) => void;
  getActiveSessions?: () => Iterable<Session>;
  gitRunner?: GitRunner;
  /** Runs a `setup`/`teardown` shell command. Defaults to a no-op success. */
  runCommand?: CommandRunner;
  /** Resolve the `pi-studio.json` worktree lifecycle commands for a project root. */
  readWorktreeLifecycle?: (projectRoot: string) => Promise<{ setup: string[]; teardown: string[] }>;
  /** Structured-generation branch-name generator. */
  generateBranchName?: (prompt: string) => Promise<string>;
  /** `worktrees.root` daemon-config override; defaults to `$PI_STUDIO_HOME/worktrees`. */
  worktreeRoot?: string;
  /** Active agents (for archiving contained agents + auto-archive coupling). */
  listAgents?: () => AgentLike[];
  /** Archive an agent by id (cascades per AgentManager). */
  archiveAgent?: (id: string) => Promise<void>;
}

/** Slug a branch/worktree name: lowercase, keep `[a-z0-9-/]`, collapse separators. */
export function slugBranchName(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9/\s_-]/g, "")
    .replace(/[\s_]+/g, "-")
    .replace(/\/+/g, "/")
    .replace(/-{2,}/g, "-")
    .replace(/^[-/]+|[-/]+$/g, "");
  return slug || "work";
}

/**
 * Resolve a unique, length-bounded worktree name. Over-long names are truncated and a deterministic
 * 7-char hash suffix is appended; colliding names get a deterministic suffix that increments a salt
 * until unique within `existing`.
 */
export function resolveWorktreeName(
  rawName: string,
  existing: ReadonlySet<string>,
  maxLen = MAX_WORKTREE_NAME,
): string {
  const base = slugBranchName(rawName);
  if (base.length <= maxLen && !existing.has(base)) return base;

  const room = Math.max(1, maxLen - 8); // 1 sep + 7 hash chars
  const truncated = base.slice(0, room).replace(/[-/]+$/, "");
  for (let salt = 0; salt < 1000; salt++) {
    const hash = createHash("sha256").update(`${rawName}:${salt}`).digest("hex").slice(0, 7);
    const candidate = `${truncated}-${hash}`;
    if (!existing.has(candidate)) return candidate;
  }
  // Extremely unlikely fallthrough.
  return `${truncated}-${createHash("sha256").update(rawName).digest("hex").slice(0, 12)}`;
}

export class WorktreeService {
  private readonly registry: WorkspaceRegistryService;
  private readonly git: GitRunner;
  private readonly runCommand: CommandRunner;

  constructor(private readonly deps: WorktreeServiceDeps) {
    this.registry = deps.registry ?? new WorkspaceRegistryService(deps.home);
    this.git = deps.gitRunner ?? defaultGitRunner;
    this.runCommand = deps.runCommand ?? (async () => ({ code: 0, stdout: "", stderr: "" }));
  }

  registerHandlers(registry: HandlerRegistry, getActiveSessions: () => Iterable<Session>): void {
    registry.register("create_pistudio_worktree_request", async (ctx) => {
      const descriptor = await this.createWorktree(
        {
          projectRoot: String(ctx.message.projectRoot ?? ctx.message.cwd ?? ""),
          projectId: String(ctx.message.projectId ?? ""),
          name: ctx.message.name as string | undefined,
          branch: ctx.message.branch as string | undefined,
          baseRef: ctx.message.baseRef as string | undefined,
          generatePrompt: ctx.message.generatePrompt as string | undefined,
        },
        getActiveSessions,
      );
      return { type: "create_pistudio_worktree_response", worktree: descriptor };
    });

    registry.register("pistudio_worktree_list_request", async () => ({
      type: "pistudio_worktree_list_response",
      worktrees: (await this.registry.listActiveWorkspaces()).filter((w) => w.kind === "worktree"),
    }));

    registry.register("pistudio_worktree_archive_request", async (ctx) => {
      const workspaceId = String(ctx.message.workspaceId ?? "");
      const ok = await this.archiveWorktree(workspaceId, getActiveSessions);
      return { type: "pistudio_worktree_archive_response", workspaceId, ok };
    });
  }

  private worktreeRoot(): string {
    return this.deps.worktreeRoot ?? join(this.deps.home, "worktrees");
  }

  /** Create a Pi-Studio worktree, register it, and run `setup`. */
  async createWorktree(
    intent: CreateWorktreeIntent,
    getActiveSessions: () => Iterable<Session> = this.deps.getActiveSessions ?? (() => []),
  ): Promise<WorktreeDescriptor> {
    const root = this.worktreeRoot();

    // Existing worktree names occupied under the root (from the active registry).
    const occupied = new Set(
      (await this.registry.listActiveWorkspaces())
        .filter((w) => w.kind === "worktree")
        .map((w) => basename(w.cwd)),
    );

    // Resolve target branch + worktree name.
    let branch: string;
    let isNewBranch: boolean;
    if (intent.branch && intent.branch.trim().length > 0) {
      branch = intent.branch.trim();
      isNewBranch = false;
    } else {
      const raw =
        intent.name?.trim() ||
        (intent.generatePrompt && this.deps.generateBranchName
          ? await this.deps.generateBranchName(intent.generatePrompt)
          : "") ||
        intent.generatePrompt ||
        "work";
      branch = slugBranchName(raw);
      isNewBranch = true;
    }

    const name = resolveWorktreeName(intent.name?.trim() || branch, occupied);
    const path = join(root, name);

    const args = isNewBranch
      ? ["worktree", "add", "-b", branch, path, ...(intent.baseRef ? [intent.baseRef] : [])]
      : ["worktree", "add", path, branch];
    const added = await this.git(args, intent.projectRoot);
    if (added.code !== 0) {
      throw new Error(`git worktree add failed: ${added.stdout}`.trim());
    }

    const { workspace } = await this.registry.resolveOrCreateWorkspace({
      projectId: intent.projectId,
      cwd: path,
      kind: "worktree",
      displayName: name,
    });

    const setupOk = await this.runLifecycle("setup", intent.projectRoot, path, getActiveSessions);

    this.deps.broadcast(getActiveSessions(), {
      type: "workspace_update",
      workspaceId: workspace.workspaceId,
      projectId: workspace.projectId,
      cwd: workspace.cwd,
      kind: "worktree",
      displayName: workspace.displayName,
      archivedAt: null,
      branch,
    });

    return { workspace, name, branch, path, setupOk };
  }

  /** Archive a worktree: teardown → archive contained agents → `git worktree remove`/prune. */
  async archiveWorktree(
    workspaceId: string,
    getActiveSessions: () => Iterable<Session> = this.deps.getActiveSessions ?? (() => []),
  ): Promise<boolean> {
    const workspaces = await this.registry.listWorkspaces();
    const workspace = workspaces.find((w) => w.workspaceId === workspaceId);
    if (!workspace || workspace.archivedAt) return false;

    const path = workspace.cwd;
    await this.runLifecycle("teardown", null, path, getActiveSessions);

    // Archive every agent whose cwd is inside the worktree.
    const inside = (this.deps.listAgents?.() ?? []).filter((a) => isInside(path, a.cwd));
    for (const agent of inside) {
      await this.deps.archiveAgent?.(agent.id);
    }

    // Remove + prune the git worktree (best-effort; ignore failure so the record still archives).
    await this.git(["worktree", "remove", "--force", path], path).catch(() => undefined);
    await this.git(["worktree", "prune"], path).catch(() => undefined);

    const archived = await this.registry.archiveWorkspace(workspaceId);
    if (archived) {
      this.deps.broadcast(getActiveSessions(), {
        type: "workspace_update",
        workspaceId,
        archivedAt: archived.archivedAt,
        kind: "worktree",
      });
    }
    return true;
  }

  /**
   * Auto-archive coupling: when an agent created with `autoArchive` + a `worktree` target reaches a
   * terminal turn, archive the agent AND its worktree (which cascades to any agents inside it).
   * Returns true when an auto-archive was performed.
   */
  async maybeAutoArchiveOnTerminalTurn(
    agent: AgentLike,
    getActiveSessions: () => Iterable<Session> = this.deps.getActiveSessions ?? (() => []),
  ): Promise<boolean> {
    const autoArchive = agent.labels[AUTO_ARCHIVE_LABEL] === "true";
    const worktreeId = agent.labels[WORKTREE_WORKSPACE_ID_LABEL];
    if (!autoArchive || !worktreeId) return false;
    return this.archiveWorktree(worktreeId, getActiveSessions);
  }

  private async runLifecycle(
    phase: "setup" | "teardown",
    sourceCheckoutPath: string | null,
    worktreePath: string,
    getActiveSessions: () => Iterable<Session>,
  ): Promise<boolean> {
    const lifecycle = this.deps.readWorktreeLifecycle
      ? await this.deps.readWorktreeLifecycle(sourceCheckoutPath ?? worktreePath)
      : { setup: [], teardown: [] };
    const commands = lifecycle[phase];
    if (commands.length === 0) return true;

    const env: Record<string, string> = {
      PI_STUDIO_WORKTREE_PATH: worktreePath,
      PI_STUDIO_SOURCE_CHECKOUT_PATH: sourceCheckoutPath ?? worktreePath,
    };

    let ok = true;
    for (let i = 0; i < commands.length; i++) {
      const command = commands[i] as string;
      const result = await this.runCommand(command, { cwd: worktreePath, env });
      this.deps.broadcast(getActiveSessions(), {
        type: "workspace_setup_progress",
        worktreePath,
        phase,
        index: i,
        total: commands.length,
        command,
        code: result.code,
      });
      if (result.code !== 0) {
        ok = false;
        break; // surface the failure; worktree remains for inspection
      }
    }
    return ok;
  }
}

function basename(p: string): string {
  const norm = normalizePath(p);
  const parts = norm.split("/");
  return parts[parts.length - 1] || norm;
}

/** True when `child` is the worktree path or nested under it. */
function isInside(root: string, child: string): boolean {
  const r = normalizePath(root);
  const c = normalizePath(child);
  return c === r || c.startsWith(`${r}/`);
}
