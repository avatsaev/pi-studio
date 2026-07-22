/**
 * `use-explorer-tree` — one TanStack Query per expanded directory path (POC_TO_APP_PLAN_UI.md
 * §4.7 tree-view follow-up). `FileExplorer`'s `explorer-store` tracks *which* paths are expanded;
 * this hook fetches each of them (via the same `file_explorer_request` + `rpcKeys.explorer` cache
 * `use-explorer.ts` uses for the single-path case, so results are shared/deduped) and hands back a
 * lookup keyed by path for `flattenTree` (`features/files/file-tree.ts`) to walk into rows.
 *
 * Collapsing a directory drops it from `expanded`, so its query stops being requested here — but
 * TanStack Query keeps the cached entry around under `rpcKeys.explorer(path)`, so re-expanding is
 * instant until the cache is invalidated (`filesChanged`, an upload, a delete, ...).
 */

import { useMemo } from "react";
import { useQueries } from "@tanstack/react-query";
import { useConnectionStore } from "@pi-studio-ui/lib/connection/connection-store.js";
import { rpcKeys } from "@pi-studio-ui/lib/connection/rpc-keys.js";
import { fetchExplorerListing, type ExplorerListing } from "./use-explorer.js";

export interface ExplorerTreeEntry {
  listing: ExplorerListing | undefined;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
}

export function useExplorerTree(expanded: Set<string>): Map<string, ExplorerTreeEntry> {
  const client = useConnectionStore((s) => s.client);
  const paths = useMemo(() => Array.from(expanded), [expanded]);

  const results = useQueries({
    queries: paths.map((path) => ({
      queryKey: rpcKeys.explorer(path),
      queryFn: (): Promise<ExplorerListing> => {
        if (!client) throw new Error("not connected");
        return fetchExplorerListing(client, path);
      },
      enabled: Boolean(client) && Boolean(path),
    })),
  });

  return useMemo(() => {
    const map = new Map<string, ExplorerTreeEntry>();
    paths.forEach((path, i) => {
      const result = results[i];
      map.set(path, {
        listing: result?.data,
        isLoading: Boolean(result?.isLoading),
        isError: Boolean(result?.isError),
        error: result?.error,
      });
    });
    return map;
  }, [paths, results]);
}
