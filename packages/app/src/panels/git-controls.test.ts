import { describe, it, expect } from "vitest";
import {
  filterBranches,
  partitionBranches,
  validateBranchName,
  toggleStaged,
  buildCommitPayload,
  deriveActionContext,
  primaryActionLabel,
  hasConflicts,
  buildConflictList,
  buildResolveConflictPayload,
  allConflictsResolved,
  buildWorktreeCallout,
  type BranchOption,
  type GitStatusSummary,
} from "./git-controls.js";
import { buildGitActions } from "./git-panel.js";

const branches: BranchOption[] = [
  { name: "main", isRemote: false, isCurrent: true },
  { name: "feature/login", isRemote: false, isCurrent: false },
  { name: "feature/logout", isRemote: false, isCurrent: false },
  { name: "origin/main", isRemote: true, isCurrent: false },
];

describe("branch switcher", () => {
  it("filters branches by substring, ranking prefix matches first", () => {
    const r = filterBranches(branches, "feature");
    expect(r.map((b) => b.name)).toEqual(["feature/login", "feature/logout"]);
  });

  it("returns all branches for an empty query", () => {
    expect(filterBranches(branches, "  ")).toHaveLength(4);
  });

  it("partitions into local and remote", () => {
    const { local, remote } = partitionBranches(branches);
    expect(local).toHaveLength(3);
    expect(remote).toHaveLength(1);
  });

  it("validates + slugs branch names", () => {
    expect(validateBranchName("My New Feature")).toEqual({ valid: true, slug: "my-new-feature" });
    expect(validateBranchName("  ").valid).toBe(false);
    expect(validateBranchName("a..b").valid).toBe(false);
    expect(validateBranchName("Feat/Cool Thing!").slug).toBe("feat/cool-thing");
  });
});

describe("commit box", () => {
  it("toggles staged files", () => {
    expect(toggleStaged(["a"], "b")).toEqual(["a", "b"]);
    expect(toggleStaged(["a", "b"], "a")).toEqual(["b"]);
  });

  it("builds a commit payload trimming message and carrying staged files + push", () => {
    expect(buildCommitPayload("s1", "/w", "  fix bug  ", ["a", "b"], true)).toEqual({
      serverId: "s1",
      cwd: "/w",
      message: "fix bug",
      files: ["a", "b"],
      push: true,
    });
  });

  it("omits files when nothing staged", () => {
    expect(buildCommitPayload("s1", "/w", "m", []).files).toBeUndefined();
  });
});

describe("git action state derivation", () => {
  it("labels primary action by repo state", () => {
    expect(primaryActionLabel({ isDirty: true })).toBe("Commit");
    expect(primaryActionLabel({ isDirty: false, aheadCount: 2 })).toBe("Push");
    expect(primaryActionLabel({ isDirty: false, behindCount: 1 })).toBe("Pull");
    expect(primaryActionLabel({ isDirty: false })).toBe("Up to date");
  });

  it("derives a context that makes Push primary when ahead + clean", () => {
    const ctx = deriveActionContext({ isDirty: false, aheadCount: 3 });
    const cluster = buildGitActions(ctx);
    expect(cluster.primary.id).toBe("push");
  });

  it("makes Commit primary when dirty", () => {
    const cluster = buildGitActions(deriveActionContext({ isDirty: true }));
    expect(cluster.primary.id).toBe("commit");
  });
});

describe("conflict resolution", () => {
  const status: GitStatusSummary = { isDirty: true, conflicts: ["a.ts", "b.ts"] };

  it("detects conflicts and builds the file list", () => {
    expect(hasConflicts(status)).toBe(true);
    expect(hasConflicts({ isDirty: false })).toBe(false);
    expect(buildConflictList(status).map((f) => f.path)).toEqual(["a.ts", "b.ts"]);
  });

  it("builds a resolve payload", () => {
    expect(buildResolveConflictPayload("s1", "/w", "a.ts", "theirs")).toEqual({
      serverId: "s1",
      cwd: "/w",
      path: "a.ts",
      resolution: "theirs",
    });
  });

  it("reports all-resolved only when every file has a resolution", () => {
    const files = buildConflictList(status);
    expect(allConflictsResolved(files)).toBe(false);
    expect(allConflictsResolved(files.map((f) => ({ ...f, resolution: "ours" as const })))).toBe(true);
    expect(allConflictsResolved([])).toBe(false);
  });
});

describe("worktree callout", () => {
  it("is hidden for a non-worktree workspace", () => {
    expect(buildWorktreeCallout({ isDirty: false }).visible).toBe(false);
  });

  it("shows the branch when on a worktree", () => {
    const c = buildWorktreeCallout({ isDirty: false, isWorktree: true, branch: "feat/x" });
    expect(c.visible).toBe(true);
    expect(c.message).toBe("Working on branch feat/x in a worktree");
  });
});
