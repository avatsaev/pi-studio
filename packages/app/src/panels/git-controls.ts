// Commit box, branch switcher, git-actions state derivation, and conflict
// resolution — pure models wired to daemon RPCs by hooks/components.
//
// clean-room-scope/features/feature-panels-ui.md § git actions, § commit box
// clean-room-scope/features/git-checkout.md § branch operations

import type { GitActionContext } from "./git-panel.js";

// ─── Branch switcher ─────────────────────────────────────────────────────────

export interface BranchOption {
  name: string;
  isRemote: boolean;
  isCurrent: boolean;
  aheadCount?: number;
  behindCount?: number;
  lastCommit?: string;
}

/** Case-insensitive fuzzy-ish filter over branch names (substring, ranked). */
export function filterBranches(branches: readonly BranchOption[], query: string): BranchOption[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...branches];
  return branches
    .filter((b) => b.name.toLowerCase().includes(q))
    .sort((a, b) => {
      // Exact prefix match ranks above mid-string match.
      const ap = a.name.toLowerCase().startsWith(q) ? 0 : 1;
      const bp = b.name.toLowerCase().startsWith(q) ? 0 : 1;
      if (ap !== bp) return ap - bp;
      return a.name.localeCompare(b.name);
    });
}

export function partitionBranches(branches: readonly BranchOption[]): {
  local: BranchOption[];
  remote: BranchOption[];
} {
  return {
    local: branches.filter((b) => !b.isRemote),
    remote: branches.filter((b) => b.isRemote),
  };
}

export interface BranchNameValidation {
  valid: boolean;
  slug: string;
  error?: string;
}

/** Validate + slug a branch name (git ref rules, simplified). */
export function validateBranchName(raw: string): BranchNameValidation {
  const name = raw.trim();
  if (!name) return { valid: false, slug: "", error: "Branch name is required" };
  // Slug: spaces → dashes, strip disallowed chars, collapse dashes/slashes.
  const slug = name
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9._/-]/g, "")
    .replace(/-+/g, "-")
    .replace(/\/+/g, "/")
    .replace(/^[-/]+|[-/]+$/g, "");
  if (!slug) return { valid: false, slug: "", error: "Branch name has no valid characters" };
  if (slug.includes("..")) return { valid: false, slug, error: "Branch name cannot contain '..'" };
  return { valid: true, slug };
}

// ─── Commit box ──────────────────────────────────────────────────────────────

export interface StageableFile {
  path: string;
  staged: boolean;
}

/** Toggle staging for a single file, returning the updated staged path list. */
export function toggleStaged(stagedPaths: readonly string[], path: string): string[] {
  return stagedPaths.includes(path)
    ? stagedPaths.filter((p) => p !== path)
    : [...stagedPaths, path];
}

export interface CommitPayload {
  serverId: string;
  cwd: string;
  message: string;
  files?: string[];
  push?: boolean;
}

export function buildCommitPayload(
  serverId: string,
  cwd: string,
  message: string,
  stagedPaths: readonly string[],
  push = false,
): CommitPayload {
  return {
    serverId,
    cwd,
    message: message.trim(),
    files: stagedPaths.length > 0 ? [...stagedPaths] : undefined,
    push,
  };
}

/** RPC to request an agent-generated commit message from the current diff. */
export const SUGGEST_COMMIT_RPC = "checkout_suggest_commit_message_request" as const;

export interface SuggestCommitRequest {
  serverId: string;
  cwd: string;
}

// ─── Git actions state derivation ──────────────────────────────────────────

export interface GitStatusSummary {
  branch?: string;
  aheadCount?: number;
  behindCount?: number;
  isDirty: boolean;
  hasUpstream?: boolean;
  conflicts?: string[];
  isWorktree?: boolean;
  hasPr?: boolean;
  hasBase?: boolean;
}

/** Project a git status summary into the context `buildGitActions` consumes. */
export function deriveActionContext(
  status: GitStatusSummary,
  runState: { committing?: boolean; pushing?: boolean } = {},
): GitActionContext {
  return {
    isDirty: status.isDirty,
    isBehind: (status.behindCount ?? 0) > 0,
    isWorktree: status.isWorktree ?? false,
    hasPr: status.hasPr ?? false,
    hasBase: status.hasBase ?? false,
    committing: runState.committing ?? false,
    pushing: runState.pushing ?? false,
  };
}

export type PrimaryActionLabel = "Commit" | "Push" | "Pull" | "Up to date";

/** The single headline label for the git-status badge / primary button. */
export function primaryActionLabel(status: GitStatusSummary): PrimaryActionLabel {
  if (status.isDirty) return "Commit";
  if ((status.aheadCount ?? 0) > 0) return "Push";
  if ((status.behindCount ?? 0) > 0) return "Pull";
  return "Up to date";
}

// ─── Conflict resolution ─────────────────────────────────────────────────────

export type ConflictResolution = "ours" | "theirs" | "manual";

export interface ConflictFile {
  path: string;
  resolution?: ConflictResolution;
}

export function hasConflicts(status: GitStatusSummary): boolean {
  return (status.conflicts?.length ?? 0) > 0;
}

export function buildConflictList(status: GitStatusSummary): ConflictFile[] {
  return (status.conflicts ?? []).map((path) => ({ path }));
}

export interface ResolveConflictPayload {
  serverId: string;
  cwd: string;
  path: string;
  resolution: ConflictResolution;
}

export function buildResolveConflictPayload(
  serverId: string,
  cwd: string,
  path: string,
  resolution: ConflictResolution,
): ResolveConflictPayload {
  return { serverId, cwd, path, resolution };
}

export function allConflictsResolved(files: readonly ConflictFile[]): boolean {
  return files.length > 0 && files.every((f) => f.resolution != null);
}

// ─── Worktree callout ──────────────────────────────────────────────────────

export interface WorktreeCallout {
  visible: boolean;
  branch?: string;
  message: string;
}

export function buildWorktreeCallout(status: GitStatusSummary): WorktreeCallout {
  if (!status.isWorktree) return { visible: false, message: "" };
  return {
    visible: true,
    branch: status.branch,
    message: status.branch
      ? `Working on branch ${status.branch} in a worktree`
      : "Working in a worktree",
  };
}
