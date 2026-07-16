/**
 * `use-explorer` — TanStack Query wrapper over `file_explorer_request` (POC `loadFiles`,
 * POC_TO_APP_PLAN_UI.md §4.7 / §3 `hooks/use-explorer.ts`). Directory listings are read-through
 * cached, keyed by resolved path — components resolve `~` via `resolveTildePath` before calling.
 */

import { useQuery } from "@tanstack/react-query";
import { useConnectionStore } from "../lib/connection/connection-store.js";
import { rpcKeys } from "../lib/connection/rpc-keys.js";

export interface ExplorerEntry {
  name: string;
  kind: "file" | "directory" | "symlink" | "other";
  size?: number;
  mtimeMs?: number;
}

interface RawExplorerEntry {
  name?: string;
  kind?: string;
  type?: string;
  size?: number;
  mtimeMs?: number;
}

interface ExplorerDirectoryResult {
  ok: true;
  kind: "directory";
  path: string;
  resolvedPath: string;
  entries: RawExplorerEntry[];
}

interface ExplorerTextResult {
  ok: true;
  kind: "text";
  path: string;
  resolvedPath: string;
  content: string;
  size: number;
}

interface ExplorerErrorResult {
  ok: false;
  error: string;
}

type ExplorerResult = ExplorerDirectoryResult | ExplorerTextResult | ExplorerErrorResult;

interface ExplorerRpcResponse {
  result?: ExplorerResult;
}

export interface ExplorerListing {
  path: string;
  entries: ExplorerEntry[];
}

function normalizeEntry(e: RawExplorerEntry): ExplorerEntry {
  const kind = e.kind === "directory" || e.type === "directory" ? "directory" : "file";
  return { name: e.name ?? "", kind, size: e.size, mtimeMs: e.mtimeMs };
}

/** Dirs first (alphabetical), then files (alphabetical) — POC `fileList.sort`. */
function sortEntries(entries: ExplorerEntry[]): ExplorerEntry[] {
  return entries.slice().sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "directory" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

export function useExplorer(path: string, enabled = true) {
  const client = useConnectionStore((s) => s.client);

  return useQuery({
    queryKey: rpcKeys.explorer(path),
    queryFn: async (): Promise<ExplorerListing> => {
      if (!client) throw new Error("not connected");
      const response = await client.connection.request<ExplorerRpcResponse>(
        "file_explorer_request",
        { path },
      );
      const result = response.result;
      if (!result || result.ok === false) {
        throw new Error(result && "error" in result ? result.error : "explorer request failed");
      }
      const entries = "entries" in result ? (result.entries ?? []) : [];
      return {
        path: result.resolvedPath ?? path,
        entries: sortEntries(entries.map(normalizeEntry)),
      };
    },
    enabled: Boolean(client) && Boolean(path) && enabled,
  });
}
