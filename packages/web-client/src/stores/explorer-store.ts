/**
 * Explorer store — the right-sidebar Files tab's navigation position (POC `currentFilePath`
 * global, POC_TO_APP_PLAN_UI.md §4.7 / §3 `stores/explorer-store.ts`). File listing data itself is
 * TanStack Query cache (see `hooks/use-explorer.ts`), NOT store state — this store only tracks
 * *where* the explorer is currently looking.
 */

import { create } from "zustand";
import type { PiStudioClient } from "@av-pi-studio/client";

interface ExplorerStoreState {
  currentPath: string;
  /** The active workspace's resolved cwd — the upper navigation boundary. `goUp()` never
   * crosses above it and the "up" row hides once `currentPath` reaches it (§4.7: the file
   * explorer is scoped to the workspace, not a general filesystem browser). */
  rootPath: string;

  /** Set both the boundary and the current position — called when the active workspace changes
   * (POC_TO_APP_PLAN_UI.md §4.7 follow-up: workspace-scoped browsing). */
  setRoot(path: string): void;
  setPath(path: string): void;
  /** Navigate to the parent of `currentPath` (POC `#file-up` click handler), clamped to `rootPath`. */
  goUp(): void;
}

export const useExplorerStore = create<ExplorerStoreState>()((set, get) => ({
  currentPath: "",
  rootPath: "",

  setRoot: (path) => set({ rootPath: path, currentPath: path }),

  setPath: (path) => set({ currentPath: path }),

  goUp: () => {
    const { currentPath, rootPath } = get();
    if (!rootPath || currentPath === rootPath) return;
    const parent = currentPath.split("/").slice(0, -1).join("/") || "/";
    // Never navigate above the workspace root: if the computed parent is shorter than (or not a
    // prefix of) rootPath, we've reached — or would overshoot — the boundary, so clamp to it.
    const clamped = parent.length < rootPath.length || !parent.startsWith(rootPath) ? rootPath : parent;
    set({ currentPath: clamped });
  },
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
