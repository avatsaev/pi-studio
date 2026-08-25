/**
 * Explorer store — the right-sidebar Files tab's tree-expansion state (POC `currentFilePath`
 * global, superseded by a tree view: POC_TO_APP_PLAN_UI.md §4.7 / §3 `stores/explorer-store.ts`).
 * File listing data itself is TanStack Query cache (see `hooks/use-explorer.ts`), NOT store
 * state — this store only tracks *which directories are expanded*, not their contents.
 *
 * `expandedByRoot` remembers each workspace's expanded-path set across workspace-tab switches,
 * keyed by that workspace's resolved root path — restored when `setRoot` is called again with the
 * same root (in-memory only, for the lifetime of the session; not persisted to disk).
 */

import { create } from "zustand";

interface ExplorerStoreState {
  /** The active workspace's resolved cwd — the tree root. Rendered as the tree's own first row,
   * a collapsible directory row with its children at depth 1 (`file-tree.ts`'s `flattenTree`);
   * there is nothing above it to show, since the explorer is workspace-scoped, not a general
   * filesystem browser. */
  rootPath: string;
  /** Absolute paths of directories currently expanded in the tree. Contains `rootPath` unless
   * the user has collapsed the root row itself. */
  expanded: Set<string>;
  /** Session memory of each workspace's `expanded` set, keyed by its resolved root path. Keys
   * are inserted dynamically as workspaces are visited this session, so a `Map` (not `Record`)
   * is the right fit here. */
  expandedByRoot: Map<string, Set<string>>;

  /** Switch the tree root — called when the active workspace changes. Saves the outgoing root's
   * `expanded` set into `expandedByRoot` and restores the incoming root's remembered set. A root
   * never visited this session is seeded expanded; a *remembered* set is restored verbatim, so a
   * deliberately collapsed root stays collapsed across workspace switches. */
  setRoot(path: string): void;
  toggle(path: string): void;
  /** In-progress inline "new file"/"new folder" row in the tree: the directory it will be
   * created in, and which kind. Only one draft at a time. */
  draft: { parentPath: string; kind: "file" | "directory" } | null;
  /** Begin an inline draft under `parentPath`, expanding it so the draft row is visible. */
  startDraft(parentPath: string, kind: "file" | "directory"): void;
  cancelDraft(): void;
  /** Absolute path of the row currently being renamed in place, or null. Only one inline editor
   *  exists at a time, so this and `draft` are never both set. */
  renaming: string | null;
  /** Begin renaming `path`; discards any in-progress create draft. */
  startRename(path: string): void;
  cancelRename(): void;
  /** Last-clicked row (directory or file) — where "New File"/"New Folder" (header toolbar and
   * the empty-space context menu) create their new entry: the selected directory itself, or the
   * selected file's parent directory. `null` (nothing selected yet) falls back to `rootPath`. */
  selected: { path: string; isDirectory: boolean } | null;
  setSelected(selected: { path: string; isDirectory: boolean } | null): void;
  /** Rewrite tree state after a move: any expanded path equal to `from` or nested under it
   * becomes the same path under `to`, and `selected` follows the same rewrite. Also expands
   * `toParent` so the moved item is visible where it landed. */
  repathAfterMove(from: string, to: string, toParent: string): void;
}

export const useExplorerStore = create<ExplorerStoreState>()((set) => ({
  rootPath: "",
  expanded: new Set(),
  expandedByRoot: new Map(),
  draft: null,
  renaming: null,
  selected: null,

  setRoot: (path) =>
    set((s) => {
      const expandedByRoot = new Map(s.expandedByRoot);
      if (s.rootPath) expandedByRoot.set(s.rootPath, s.expanded);
      const remembered = expandedByRoot.get(path);
      return {
        rootPath: path,
        expanded: remembered ? new Set(remembered) : new Set([path]),
        expandedByRoot,
        draft: null,
        selected: null,
        renaming: null,
      };
    }),

  toggle: (path) =>
    set((s) => {
      const expanded = new Set(s.expanded);
      if (expanded.has(path)) expanded.delete(path);
      else expanded.add(path);
      const expandedByRoot = new Map(s.expandedByRoot);
      expandedByRoot.set(s.rootPath, expanded);
      return { expanded, expandedByRoot };
    }),

  startDraft: (parentPath, kind) =>
    set((s) => {
      const expanded = new Set(s.expanded);
      expanded.add(parentPath);
      const expandedByRoot = new Map(s.expandedByRoot);
      if (s.rootPath) expandedByRoot.set(s.rootPath, expanded);
      return { draft: { parentPath, kind }, expanded, expandedByRoot, renaming: null };
    }),

  cancelDraft: () => set({ draft: null }),

  startRename: (path) => set({ renaming: path, draft: null }),

  cancelRename: () => set({ renaming: null }),

  setSelected: (selected) => set({ selected }),

  repathAfterMove: (from, to, toParent) =>
    set((s) => {
      const rewrite = (p: string) =>
        p === from ? to : p.startsWith(`${from}/`) ? to + p.slice(from.length) : p;

      const expanded = new Set([...s.expanded].map(rewrite));
      expanded.add(toParent);
      const expandedByRoot = new Map(s.expandedByRoot);
      if (s.rootPath) expandedByRoot.set(s.rootPath, expanded);

      const selected = s.selected
        ? { path: rewrite(s.selected.path), isDirectory: s.selected.isDirectory }
        : null;

      return { expanded, expandedByRoot, selected, renaming: null };
    }),
}));
