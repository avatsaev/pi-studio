// File explorer panel view model.
// clean-room-scope/features/feature-panels-ui.md § File explorer

export type ExplorerSortMode = "name" | "modified" | "size";

export type ExplorerEntryKind = "directory" | "file";

export type ExplorerEntry = {
  name: string;
  path: string;
  kind: ExplorerEntryKind;
  size?: number;
  modifiedMs?: number;
};

export type ExplorerNode = {
  entry: ExplorerEntry;
  depth: number;
  expanded: boolean;
  loading: boolean;
  children: ExplorerNode[];
};

export type ExplorerState = {
  sortMode: ExplorerSortMode;
  expandedPaths: Set<string>;
  showHidden: boolean;
  loading: boolean;
  error?: string;
  root: ExplorerNode[];
};

export const INITIAL_EXPLORER_STATE: ExplorerState = {
  sortMode: "name",
  expandedPaths: new Set(),
  showHidden: false,
  loading: false,
  root: [],
};

// Sort entries: dirs always before files, then by the selected sort mode.
export function sortEntries(entries: readonly ExplorerEntry[], mode: ExplorerSortMode): ExplorerEntry[] {
  return [...entries].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "directory" ? -1 : 1;
    switch (mode) {
      case "name": return a.name.localeCompare(b.name);
      case "modified": return (b.modifiedMs ?? 0) - (a.modifiedMs ?? 0);
      case "size": return (b.size ?? 0) - (a.size ?? 0);
    }
  });
}

export function cycleSortMode(current: ExplorerSortMode): ExplorerSortMode {
  const cycle: ExplorerSortMode[] = ["name", "modified", "size"];
  return cycle[(cycle.indexOf(current) + 1) % cycle.length]!;
}

// Build tree nodes from a flat entry list at a given depth.
export function buildNodes(entries: readonly ExplorerEntry[], depth: number, expandedPaths: ReadonlySet<string>, mode: ExplorerSortMode): ExplorerNode[] {
  return sortEntries(entries, mode).map((entry) => ({
    entry,
    depth,
    expanded: expandedPaths.has(entry.path),
    loading: false,
    children: [],
  }));
}

// Flatten the tree by DFS into a display list (only expanded dirs recurse).
export function flattenTree(nodes: readonly ExplorerNode[]): ExplorerNode[] {
  const result: ExplorerNode[] = [];
  for (const node of nodes) {
    result.push(node);
    if (node.entry.kind === "directory" && node.expanded && node.children.length > 0) {
      result.push(...flattenTree(node.children));
    }
  }
  return result;
}

// Apply loaded children into a tree (immutable).
export function insertChildren(nodes: ExplorerNode[], targetPath: string, children: ExplorerNode[]): ExplorerNode[] {
  return nodes.map((node) => {
    if (node.entry.path === targetPath) return { ...node, children, loading: false };
    if (node.children.length > 0) return { ...node, children: insertChildren(node.children, targetPath, children) };
    return node;
  });
}

export function setNodeLoading(nodes: ExplorerNode[], targetPath: string, loading: boolean): ExplorerNode[] {
  return nodes.map((node) => {
    if (node.entry.path === targetPath) return { ...node, loading };
    if (node.children.length > 0) return { ...node, children: setNodeLoading(node.children, targetPath, loading) };
    return node;
  });
}

export function toggleExpand(state: ExplorerState, path: string): ExplorerState {
  const next = new Set(state.expandedPaths);
  if (next.has(path)) next.delete(path); else next.add(path);
  return { ...state, expandedPaths: next };
}

// ─── Row actions ──────────────────────────────────────────────────────────

export type ExplorerRowAction =
  | { kind: "open-preview"; path: string }
  | { kind: "copy-path"; path: string }
  | { kind: "download"; path: string }
  | { kind: "reveal"; path: string };

export function rowActionsForEntry(entry: ExplorerEntry): ExplorerRowAction[] {
  const actions: ExplorerRowAction[] = [
    { kind: "open-preview", path: entry.path },
    { kind: "copy-path", path: entry.path },
  ];
  if (entry.kind === "file") actions.push({ kind: "download", path: entry.path });
  actions.push({ kind: "reveal", path: entry.path });
  return actions;
}

// ─── Path safety ──────────────────────────────────────────────────────────

export type PathSafetyResult = { safe: true } | { safe: false; reason: string };

export function checkPathSafety(path: string, workspaceDir: string): PathSafetyResult {
  if (!path.startsWith("/")) return { safe: false, reason: "Path must be absolute" };
  if (!path.startsWith(workspaceDir)) return { safe: false, reason: `Path is outside workspace (${workspaceDir})` };
  return { safe: true };
}

// ─── Upload ───────────────────────────────────────────────────────────────

export type UploadTarget = { directory: string; filename: string; destinationPath: string };

export function resolveUploadTarget(currentDirectory: string, filename: string): UploadTarget {
  const destinationPath = `${currentDirectory.replace(/\/$/, "")}/${filename}`;
  return { directory: currentDirectory, filename, destinationPath };
}

// ─── Explorer header model ────────────────────────────────────────────────

export type ExplorerHeaderModel = {
  sortMode: ExplorerSortMode;
  sortLabel: string;
  showHidden: boolean;
  refreshing: boolean;
};

export function explorerHeaderModel(state: ExplorerState, refreshing = false): ExplorerHeaderModel {
  return { sortMode: state.sortMode, sortLabel: `Sort: ${state.sortMode}`, showHidden: state.showHidden, refreshing };
}

// ─── Explorer empty/error state ────────────────────────────────────────────

export type ExplorerViewState =
  | { kind: "unavailable" }
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "empty" }
  | { kind: "tree"; nodes: ExplorerNode[] };

export function resolveExplorerViewState(state: ExplorerState, workspaceAvailable: boolean): ExplorerViewState {
  if (!workspaceAvailable) return { kind: "unavailable" };
  if (state.loading && state.root.length === 0) return { kind: "loading" };
  if (state.error) return { kind: "error", message: state.error };
  const flat = flattenTree(state.root);
  if (flat.length === 0) return { kind: "empty" };
  return { kind: "tree", nodes: flat };
}
