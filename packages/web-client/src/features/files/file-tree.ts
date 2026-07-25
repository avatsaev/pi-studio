/**
 * Pure tree-flattening for the Files tab (POC_TO_APP_PLAN_UI.md §4.7 tree-view follow-up).
 * `FileExplorer.tsx` owns `expanded` (`explorer-store.ts`) and per-path listings
 * (`useExplorerTree`); this module just walks the two into the ordered row list the virtualizer
 * renders — no React, no store access, so it's cheap to unit-test in isolation.
 *
 * The workspace root itself is never a row (§4.7: this is a workspace-scoped browser, there is
 * nothing above the root to show and nothing to collapse it to) — its children start at depth 0.
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
 * expandable/clickable. `path` is the *directory's* path (for a stable React key), not a real
 * file/dir on disk. */
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

/** The inline "new file"/"new folder" name-entry row. `path` is a synthetic key (never a real
 * filesystem path) so the virtualizer's `getItemKey` stays unique. */
interface DraftRow {
  kind: "draft";
  path: string; // `${parentPath}::draft`
  depth: number;
  draftKind: "file" | "directory";
  parentPath: string;
}

export type TreeRow = DirRow | FileRow | LoadingRow | ErrorRow | DraftRow;

/** Which directory has an in-progress inline create row, and what kind it is. */
export interface TreeDraft {
  parentPath: string;
  kind: "file" | "directory";
}

function joinPath(dir: string, name: string): string {
  return dir.endsWith("/") ? `${dir}${name}` : `${dir}/${name}`;
}

function pushChildren(
  rows: TreeRow[],
  dirPath: string,
  depth: number,
  expanded: Set<string>,
  tree: Map<string, ExplorerTreeEntry>,
  draft?: TreeDraft | null,
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
    pushEntry(rows, dirPath, entry, depth, expanded, tree, draft);
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
): void {
  const path = joinPath(parentPath, entry.name);
  if (entry.kind !== "directory") {
    rows.push({ kind: "file", path, name: entry.name, depth });
    return;
  }
  const isExpanded = expanded.has(path);
  rows.push({ kind: "directory", path, name: entry.name, depth, expanded: isExpanded });
  if (isExpanded) pushChildren(rows, path, depth + 1, expanded, tree, draft);
}

/** Flatten the tree rooted at `rootPath` into the ordered rows currently visible. */
export function flattenTree(
  rootPath: string,
  expanded: Set<string>,
  tree: Map<string, ExplorerTreeEntry>,
  draft?: TreeDraft | null,
): TreeRow[] {
  if (!rootPath) return [];
  const rows: TreeRow[] = [];
  pushChildren(rows, rootPath, 0, expanded, tree, draft);
  return rows;
}
