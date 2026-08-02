/**
 * Git-status tinting index for the Files tree — maps an absolute tree-row path to the colour it
 * should be rendered in, VS Code style (added = green, modified = amber, deleted = red), with
 * directories inheriting the status of anything changed beneath them however deeply nested.
 *
 * The data is already live: `StatusBar` owns the single `checkout_status_subscribe` for the active
 * workspace and pushes every projection into `git-store`, so this module is pure derivation over
 * `useGitStore.changes` — no extra RPC, no server change.
 *
 * Two mismatches with the tree make this more than a `Set` lookup:
 *  - `ChangeEntry.path` is **relative to the workspace root**, `TreeRow.path` is absolute. The
 *    explorer's `rootPath` is the resolved form of the same cwd the status subscription uses
 *    (both derive from `tab-store`'s `activeWorkspaceCwd`), so joining is safe.
 *  - `git status --porcelain=v2` runs with the default `-unormal`, which **collapses a wholly
 *    untracked directory into one `dir/` entry** instead of listing its files. Descendants of such
 *    a directory therefore need a prefix match, not an exact one.
 */

import { dirOf } from "@pi-studio-ui/lib/paths.js";
import type { ChangeEntry } from "@pi-studio-ui/stores/git-store.js";

export type GitRowStatus = "added" | "modified" | "deleted";

/** Status to tint a tree row with; `undefined` for clean, ignored, or non-repo paths. */
export type GitStatusLookup = (path: string) => GitRowStatus | undefined;

const NO_STATUS: GitStatusLookup = () => undefined;

/**
 * Precedence when one file carries several change entries — git's `AM` (staged addition plus an
 * unstaged edit) yields both an "added" and a "modified" row in `changes`. A new file that has
 * since been edited is still fundamentally new, so "added" outranks "modified"; a deletion
 * outranks both.
 */
function mergeFile(previous: GitRowStatus | undefined, next: GitRowStatus): GitRowStatus {
  if (previous === undefined) return next;
  if (previous === "deleted" || next === "deleted") return "deleted";
  if (previous === "added" || next === "added") return "added";
  return "modified";
}

/** A directory is green only when *everything* changed beneath it is new; any edit or deletion in
 * the subtree makes it amber. Deletions contribute "modified" — the folder itself still exists,
 * its contents merely changed. */
function contributionToParents(status: GitRowStatus): "added" | "modified" {
  return status === "added" ? "added" : "modified";
}

/**
 * Build the row -> status lookup for a tree rooted at `rootPath` from the flat change list.
 * Returns a constant `undefined` lookup when there is no root or nothing has changed, so the
 * common clean-checkout case allocates nothing.
 */
export function buildGitStatusLookup(rootPath: string, changes: ChangeEntry[]): GitStatusLookup {
  if (!rootPath || changes.length === 0) return NO_STATUS;
  // `"/"` as a root would otherwise join to `//foo`; every other root loses its trailing slash.
  const base = rootPath.replace(/\/+$/, "");

  /** Paths named directly by a change entry (files, plus collapsed untracked directories). */
  const exact = new Map<string, GitRowStatus>();
  /** Ancestor directories, rolled up from their changed descendants. */
  const ancestors = new Map<string, "added" | "modified">();
  /** Absolute paths of collapsed untracked directories, for the descendant prefix match. */
  const untrackedDirs: string[] = [];

  for (const change of changes) {
    const isCollapsedDir = change.path.endsWith("/");
    const relative = isCollapsedDir ? change.path.slice(0, -1) : change.path;
    if (!relative) continue;
    const absolute = `${base}/${relative}`;

    exact.set(absolute, mergeFile(exact.get(absolute), change.status));
    if (isCollapsedDir) untrackedDirs.push(absolute);

    const contribution = contributionToParents(change.status);
    let dir = dirOf(absolute);
    while (dir.length > base.length && dir.startsWith(base)) {
      const previous = ancestors.get(dir);
      ancestors.set(dir, previous === undefined || previous === contribution ? contribution : "modified");
      const parent = dirOf(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }

  return (path) => {
    const direct = exact.get(path) ?? ancestors.get(path);
    if (direct !== undefined) return direct;
    for (const dir of untrackedDirs) {
      if (path.startsWith(`${dir}/`)) return "added";
    }
    return undefined;
  };
}
