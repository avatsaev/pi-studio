/**
 * LiveExplorerPane — file explorer wired to the daemon `file_explorer_request`
 * RPC. Fetches the workspace root directory, lazily loads children on expand,
 * and opens files as workspace tabs.
 *
 * Replaces the static INITIAL_EXPLORER_STATE stub previously rendered in
 * PaneContentRouter.
 *
 * clean-room-scope/features/file-explorer-transfer.md, features/feature-panels-ui.md
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Explorer } from "./Explorer.js";
import {
  type ExplorerEntry,
  type ExplorerNode,
  type ExplorerState,
  type ExplorerSortMode,
  sortEntries,
  cycleSortMode,
} from "../../panels/file-explorer.js";
import { useClient } from "../../hooks/client-context.js";

interface RawEntry {
  name: string;
  kind: string;
  size?: number;
  mtimeMs?: number;
}

function normalizeEntries(dir: string, raw: RawEntry[]): ExplorerEntry[] {
  const join = (name: string) => (dir.endsWith("/") ? `${dir}${name}` : `${dir}/${name}`);
  return raw.map((e) => ({
    name: e.name,
    path: join(e.name),
    kind: e.kind === "directory" ? "directory" : "file",
    size: e.size,
    modifiedMs: e.mtimeMs,
  }));
}

export interface LiveExplorerPaneProps {
  serverId: string;
  workspaceId: string;
  /** Absolute directory to root the tree at. */
  cwd: string | undefined;
  onOpenFile: (path: string) => void;
}

export function LiveExplorerPane({ serverId, cwd, onOpenFile }: LiveExplorerPaneProps) {
  const client = useClient();
  const [rootEntries, setRootEntries] = useState<ExplorerEntry[]>([]);
  const [childrenByPath, setChildrenByPath] = useState<Record<string, ExplorerEntry[]>>({});
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());
  const [sortMode, setSortMode] = useState<ExplorerSortMode>("name");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  const listDir = useCallback(
    async (path: string): Promise<ExplorerEntry[]> => {
      if (!client) return [];
      const resp = await (client as unknown as {
        connection: { request<T>(t: string, p?: unknown): Promise<T> };
      }).connection.request<{ result?: { ok?: boolean; error?: string; path?: string; entries?: RawEntry[] } }>(
        "file_explorer_request",
        { serverId, path },
      );
      const result = resp.result ?? (resp as { ok?: boolean; path?: string; entries?: RawEntry[] });
      if (result && (result as { ok?: boolean }).ok === false) {
        throw new Error((result as { error?: string }).error ?? "Failed to list directory");
      }
      return normalizeEntries((result as { path?: string }).path ?? path, (result as { entries?: RawEntry[] }).entries ?? []);
    },
    [client, serverId],
  );

  // Load the root directory whenever cwd changes.
  useEffect(() => {
    let cancelled = false;
    setRootEntries([]);
    setChildrenByPath({});
    setExpandedPaths(new Set());
    setError(undefined);
    if (!cwd || !client) return;
    setLoading(true);
    listDir(cwd)
      .then((entries) => {
        if (!cancelled) setRootEntries(entries);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [cwd, client, listDir]);

  const handleToggleExpand = useCallback(
    (path: string) => {
      setExpandedPaths((prev) => {
        const next = new Set(prev);
        if (next.has(path)) {
          next.delete(path);
        } else {
          next.add(path);
          // Lazy-load children the first time a directory is expanded.
          setChildrenByPath((cur) => {
            if (cur[path]) return cur;
            void listDir(path)
              .then((entries) => setChildrenByPath((c) => ({ ...c, [path]: entries })))
              .catch(() => setChildrenByPath((c) => ({ ...c, [path]: [] })));
            return cur;
          });
        }
        return next;
      });
    },
    [listDir],
  );

  const root: ExplorerNode[] = useMemo(() => {
    const build = (entries: ExplorerEntry[], depth: number): ExplorerNode[] =>
      sortEntries(entries, sortMode).map((entry) => {
        const expanded = expandedPaths.has(entry.path);
        const kids = childrenByPath[entry.path];
        return {
          entry,
          depth,
          expanded,
          loading: entry.kind === "directory" && expanded && !kids,
          children: entry.kind === "directory" && expanded && kids ? build(kids, depth + 1) : [],
        };
      });
    return build(rootEntries, 0);
  }, [rootEntries, childrenByPath, expandedPaths, sortMode]);

  const state: ExplorerState = { sortMode, expandedPaths, showHidden: false, loading, error, root };

  const refresh = useCallback(() => {
    if (!cwd) return;
    setChildrenByPath({});
    setExpandedPaths(new Set());
    setLoading(true);
    listDir(cwd)
      .then(setRootEntries)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [cwd, listDir]);

  if (!cwd) {
    return <div style={{ padding: 16, opacity: 0.6, fontSize: 13 }}>No workspace directory.</div>;
  }
  if (error) {
    return <div style={{ padding: 16, color: "var(--pi-color-fg-danger, #f87171)", fontSize: 13 }}>{error}</div>;
  }

  return (
    <Explorer
      state={state}
      onToggleExpand={handleToggleExpand}
      onOpenFile={onOpenFile}
      onRefresh={refresh}
      onCycleSortMode={() => setSortMode((m) => cycleSortMode(m))}
    />
  );
}
