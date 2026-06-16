import { defaultGitRunner, type GitRunner } from "./git-detect.js";

/**
 * Git status projection (features/git-checkout.md § Status & diff, § Behavior (statusProjection)).
 * Reads `git status --porcelain=v2 --branch` and projects it to a stable client shape. Detached or
 * non-git workspaces report `available: false`.
 */

export interface CheckoutFileEntry {
  path: string;
  /** Index (staged) status code, e.g. `M`/`A`/`D`/`R`; `.` for unmodified. */
  indexStatus: string;
  /** Worktree (unstaged) status code. */
  worktreeStatus: string;
}

export interface CheckoutStatusProjection {
  available: boolean;
  branch: string | null;
  upstream: string | null;
  ahead: number;
  behind: number;
  detached: boolean;
  staged: CheckoutFileEntry[];
  unstaged: CheckoutFileEntry[];
  untracked: string[];
  conflicted: string[];
  hasConflicts: boolean;
  /** Reason when `available` is false (e.g. "not_a_git_repository"). */
  unavailableReason?: string;
}

function emptyProjection(reason: string): CheckoutStatusProjection {
  return {
    available: false,
    branch: null,
    upstream: null,
    ahead: 0,
    behind: 0,
    detached: false,
    staged: [],
    unstaged: [],
    untracked: [],
    conflicted: [],
    hasConflicts: false,
    unavailableReason: reason,
  };
}

/** Parse `git status --porcelain=v2 --branch` output into a stable projection. */
export function parsePorcelainV2(output: string): CheckoutStatusProjection {
  const projection: CheckoutStatusProjection = {
    available: true,
    branch: null,
    upstream: null,
    ahead: 0,
    behind: 0,
    detached: false,
    staged: [],
    unstaged: [],
    untracked: [],
    conflicted: [],
    hasConflicts: false,
  };

  for (const line of output.split("\n")) {
    if (line.length === 0) continue;
    if (line.startsWith("# branch.head ")) {
      const head = line.slice("# branch.head ".length).trim();
      if (head === "(detached)") projection.detached = true;
      else projection.branch = head;
    } else if (line.startsWith("# branch.upstream ")) {
      projection.upstream = line.slice("# branch.upstream ".length).trim();
    } else if (line.startsWith("# branch.ab ")) {
      const ab = line.slice("# branch.ab ".length).trim().split(/\s+/);
      for (const token of ab) {
        if (token.startsWith("+")) projection.ahead = Number.parseInt(token.slice(1), 10) || 0;
        else if (token.startsWith("-"))
          projection.behind = Number.parseInt(token.slice(1), 10) || 0;
      }
    } else if (line.startsWith("1 ") || line.startsWith("2 ")) {
      // Ordinary/renamed: "1 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <path>"
      const parts = line.split(" ");
      const xy = parts[1] ?? "..";
      const indexStatus = xy[0] ?? ".";
      const worktreeStatus = xy[1] ?? ".";
      const isRename = line.startsWith("2 ");
      // For "2" entries field 9 is "<path>\t<origPath>"; the path comes after 8 fixed fields.
      const fixedFields = isRename ? 9 : 8;
      const path = (parts.slice(fixedFields).join(" ").split("\t")[0] ?? "").trim();
      if (!path) continue;
      const entry: CheckoutFileEntry = { path, indexStatus, worktreeStatus };
      if (indexStatus !== ".") projection.staged.push(entry);
      if (worktreeStatus !== ".") projection.unstaged.push(entry);
    } else if (line.startsWith("u ")) {
      // Unmerged (conflict): "u <XY> ... <path>"
      const parts = line.split(" ");
      const path = parts.slice(10).join(" ").trim();
      if (path) projection.conflicted.push(path);
    } else if (line.startsWith("? ")) {
      projection.untracked.push(line.slice(2).trim());
    }
  }

  projection.hasConflicts = projection.conflicted.length > 0;
  return projection;
}

/** Read + project the git status for `cwd`. */
export async function projectStatus(
  cwd: string,
  runner: GitRunner = defaultGitRunner,
): Promise<CheckoutStatusProjection> {
  const inside = await runner(["rev-parse", "--is-inside-work-tree"], cwd);
  if (inside.code !== 0 || inside.stdout.trim() !== "true") {
    return emptyProjection("not_a_git_repository");
  }
  const status = await runner(["status", "--porcelain=v2", "--branch"], cwd);
  if (status.code !== 0) return emptyProjection("git_status_failed");
  return parsePorcelainV2(status.stdout);
}
