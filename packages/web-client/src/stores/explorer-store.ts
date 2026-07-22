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
import type { PiStudioClient } from "@av-pi-studio/client";

interface ExplorerStoreState {
  /** The active workspace's resolved cwd — the tree root. Always a member of `expanded`; there
   * is no row/chevron for it, its children render at depth 0 (§4.7: the file explorer is scoped
   * to the workspace, not a general filesystem browser — there is nothing above this to show). */
  rootPath: string;
  /** Absolute paths of directories currently expanded in the tree (always includes `rootPath`). */
  expanded: Set<string>;
  /** Session memory of each workspace's `expanded` set, keyed by its resolved root path. Keys
   * are inserted dynamically as workspaces are visited this session, so a `Map` (not `Record`)
   * is the right fit here. */
  expandedByRoot: Map<string, Set<string>>;

  /** Switch the tree root — called when the active workspace changes. Saves the outgoing root's
   * `expanded` set into `expandedByRoot` and restores the incoming root's remembered set (or
   * seeds a fresh one containing just the root, if this root has never been visited this
   * session). */
  setRoot(path: string): void;
  /** Expand/collapse a directory. No-op for `rootPath` itself (always expanded). */
  toggle(path: string): void;
}

export const useExplorerStore = create<ExplorerStoreState>()((set) => ({
  rootPath: "",
  expanded: new Set(),
  expandedByRoot: new Map(),

  setRoot: (path) =>
    set((s) => {
      const expandedByRoot = new Map(s.expandedByRoot);
      if (s.rootPath) expandedByRoot.set(s.rootPath, s.expanded);
      const remembered = expandedByRoot.get(path);
      const expanded = new Set(remembered);
      expanded.add(path);
      return { rootPath: path, expanded, expandedByRoot };
    }),

  toggle: (path) =>
    set((s) => {
      if (path === s.rootPath) return s;
      const expanded = new Set(s.expanded);
      if (expanded.has(path)) expanded.delete(path);
      else expanded.add(path);
      const expandedByRoot = new Map(s.expandedByRoot);
      expandedByRoot.set(s.rootPath, expanded);
      return { expanded, expandedByRoot };
    }),
}));
interface ExplorerEntry {
  name?: string;
  kind?: string;
  type?: string;
}

interface ExplorerRpcResult {
  entries?: ExplorerEntry[];
}

interface ExplorerRpcResponse {
  result?: ExplorerRpcResult;
  entries?: ExplorerEntry[];
}

let cachedHomeDir: string | null = null;
type HomeDirListener = (homeDir: string) => void;
const homeDirListeners = new Set<HomeDirListener>();

/** Subscribe to the resolved home dir becoming available; returns an unsubscribe function. */
export function onHomeDirResolved(listener: HomeDirListener): () => void {
  homeDirListeners.add(listener);
  return () => homeDirListeners.delete(listener);
}

/**
 * Ports the POC's `resolveHome()` (chat.html ~line 1055-1056): probes `file_explorer_request`
 * for `/home`, takes the first directory entry, and caches the result for the process lifetime.
 * A failure (e.g. requested before the connection is fully open) returns `/tmp` for that call but
 * is NOT cached, so a later call — once connected — can still resolve the real home dir.
 */
export async function resolveHome(client: PiStudioClient): Promise<string> {
  if (cachedHomeDir) return cachedHomeDir;
  try {
    const response = await client.connection.request<ExplorerRpcResponse>(
      "file_explorer_request",
      { path: "/home" },
    );
    const entries = response.result?.entries ?? response.entries ?? [];
    const first = entries.find((e) => e.kind === "directory" || e.type === "directory");
    cachedHomeDir = "/home/" + (first?.name || "user");
  } catch {
    return "/tmp";
  }
  for (const listener of homeDirListeners) listener(cachedHomeDir);
  return cachedHomeDir;
}

/** Synchronous best-effort peek at the cached home dir (populated once `resolveHome` has run). */
export function peekCachedHomeDir(): string | null {
  return cachedHomeDir;
}

/** Expand a leading `~` (POC's `(path === "~" || path.startsWith("~/")) ? …` pattern). */
export async function resolveTildePath(client: PiStudioClient, path: string): Promise<string> {
  if (path === "~" || path.startsWith("~/")) {
    const home = await resolveHome(client);
    return home + path.slice(1);
  }
  return path;
}
