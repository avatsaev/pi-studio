/**
 * Pure tree-flattening for the Files tab (POC_TO_APP_PLAN_UI.md §4.7 tree-view follow-up).
 * `FileExplorer.tsx` owns `expanded` (`explorer-store.ts`) and per-path listings
 * (`useExplorerTree`); this module just walks the two into the ordered row list the virtualizer
 * renders — no React, no store access, so it's cheap to unit-test in isolation.
 *
 * The workspace root is the tree's first row — a collapsible directory row naming the workspace
 * cwd, with its children at depth 1. Nothing renders above it: this is a workspace-scoped
 * browser (§4.7), not a general filesystem browser.
 */

import type { ExplorerEntry } from "@pi-studio-ui/hooks/use-explorer.js";
import type { ExplorerTreeEntry } from "@pi-studio-ui/hooks/use-explorer-tree.js";

interface DirRow {
  kind: "directory";
  /** Absolute path — also the row's stable key and the `explorer-store` toggle/query key. */
  path: string;
  name: string;
  depth: number;
  expanded: boolean;
}

interface FileRow {
  kind: "file";
  path: string;
  name: string;
  depth: number;
}

/** A directory's listing is loading, rendered indented under it — not itself
 * expandable/clickable. `path` is the *directory's* path, not a real file/dir on disk — it
 * deliberately collides with that directory's own row, which is why row identity for React goes
 * through `rowKey` (below) rather than `path`. */
interface LoadingRow {
  kind: "loading";
  path: string;
  depth: number;
}

/** A directory's listing failed to load. Same non-interactive placement as `LoadingRow`. */
interface ErrorRow {
  kind: "error";
  path: string;
  depth: number;
  message: string;
}

/** The inline "new file"/"new folder" name-entry row. `path` is synthetic (never a real
 * filesystem path) so it can't be mistaken for one by the row-identity comparisons that DO key
 * off `path` — the drop-target highlight and the active-file highlight in `FileExplorer.tsx`. */
interface DraftRow {
  kind: "draft";
  path: string; // `${parentPath}::draft`
  depth: number;
  draftKind: "file" | "directory";
  parentPath: string;
}

/** A real tree row replaced in place by its rename editor. `path` and `name` are the row's
 * *current* values; `isDirectory` keeps the correct icon while editing. Unlike `DraftRow`,
 * `path` here is the real filesystem path — the editor stands in for that exact row. */
interface RenameRow {
  kind: "rename";
  path: string;
  depth: number;
  name: string;
  isDirectory: boolean;
}

export type TreeRow = DirRow | FileRow | LoadingRow | ErrorRow | DraftRow | RenameRow;

/**
 * Stable, collision-free React/virtualizer key for a row.
 *
 * `path` alone is NOT unique: a `loading`/`error` row carries its *directory's* path, so an
 * expanded-but-unsettled directory yields two rows sharing one path — and since the root is now
 * a row of its own, that pair is on screen during every workspace's first paint. Duplicate keys
 * make React orphan one of the two nodes instead of replacing it, which is exactly the "ghost
 * text stacked on the root folder name" symptom.
 */
export function rowKey(row: TreeRow): string {
  return `${row.kind}:${row.path}`;
}

/** Which directory has an in-progress inline create row, and what kind it is. */
export interface TreeDraft {
  parentPath: string;
  kind: "file" | "directory";
}

/** Join a directory and a basename, tolerating a trailing slash on `dir`. Exported so
 * `FileExplorer.tsx`'s rename commit can compute a same-parent destination without a second copy
 * of this logic (rename is not a `resolveMoveTarget` drop target — see `applyMove`'s caller). */
export function joinPath(dir: string, name: string): string {
  return dir.endsWith("/") ? `${dir}${name}` : `${dir}/${name}`;
}

function pushChildren(
  rows: TreeRow[],
  dirPath: string,
  depth: number,
  expanded: Set<string>,
  tree: Map<string, ExplorerTreeEntry>,
  draft?: TreeDraft | null,
  renamingPath?: string | null,
): void {
  if (draft?.parentPath === dirPath) {
    rows.push({
      kind: "draft",
      path: `${dirPath}::draft`,
      depth,
      draftKind: draft.kind,
      parentPath: dirPath,
    });
  }
  const node = tree.get(dirPath);
  if (!node || node.isLoading) {
    rows.push({ kind: "loading", path: dirPath, depth });
    return;
  }
  if (node.isError) {
    const message = node.error instanceof Error ? node.error.message : "failed to load";
    rows.push({ kind: "error", path: dirPath, depth, message });
    return;
  }
  for (const entry of node.listing?.entries ?? []) {
    pushEntry(rows, dirPath, entry, depth, expanded, tree, draft, renamingPath);
  }
}
function pushEntry(
  rows: TreeRow[],
  parentPath: string,
  entry: ExplorerEntry,
  depth: number,
  expanded: Set<string>,
  tree: Map<string, ExplorerTreeEntry>,
  draft?: TreeDraft | null,
  renamingPath?: string | null,
): void {
  const path = joinPath(parentPath, entry.name);
  const isDirectory = entry.kind === "directory";
  const isExpanded = isDirectory && expanded.has(path);

  if (path === renamingPath) {
    rows.push({ kind: "rename", path, depth, name: entry.name, isDirectory });
  } else if (isDirectory) {
    rows.push({ kind: "directory", path, name: entry.name, depth, expanded: isExpanded });
  } else {
    rows.push({ kind: "file", path, name: entry.name, depth });
  }

  if (isExpanded) pushChildren(rows, path, depth + 1, expanded, tree, draft, renamingPath);
}

/**
 * Flatten the tree rooted at `rootPath` into the ordered rows currently visible.
 *
 * The root is itself the first row — a real, collapsible directory row whose children sit at
 * depth 1 beneath it, so the workspace being browsed is always named on screen. It is never
 * substituted by a rename row: renaming/deleting the workspace root is not offered (its row
 * opens the background-variant context menu, `FileExplorer.tsx`).
 */
export function flattenTree(
  rootPath: string,
  expanded: Set<string>,
  tree: Map<string, ExplorerTreeEntry>,
  draft?: TreeDraft | null,
  renamingPath?: string | null,
): TreeRow[] {
  if (!rootPath) return [];
  const rootExpanded = expanded.has(rootPath);
  const rows: TreeRow[] = [
    {
      kind: "directory",
      path: rootPath,
      name: rootPath.split("/").pop() || rootPath,
      depth: 0,
      expanded: rootExpanded,
    },
  ];
  if (rootExpanded) pushChildren(rows, rootPath, 1, expanded, tree, draft, renamingPath);
  return rows;
}
