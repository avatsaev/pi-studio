/**
 * `use-file-diff` — TanStack Query wrapper over `file_diff_request` (POC `loadDiffContent`,
 * POC_TO_APP_PLAN_UI.md §4.5 / §3 `hooks/use-file-diff.ts`).
 */

import { useQuery } from "@tanstack/react-query";
import { useConnectionStore } from "@pi-studio-ui/lib/connection/connection-store.js";
import { rpcKeys } from "@pi-studio-ui/lib/connection/rpc-keys.js";

export interface FileDiffResult {
  patch: string;
}

interface FileDiffRpcResponse {
  patch?: string;
}

export function useFileDiff(path: string, cwd: string, staged: boolean, enabled = true) {
  const client = useConnectionStore((s) => s.client);

  return useQuery({
    queryKey: rpcKeys.fileDiff(path, cwd, staged),
    queryFn: async (): Promise<FileDiffResult> => {
      if (!client) throw new Error("not connected");
      const response = await client.connection.request<FileDiffRpcResponse>("file_diff_request", {
        path,
        cwd,
        staged,
      });
      return { patch: response.patch ?? "" };
    },
    enabled: Boolean(client) && Boolean(path) && Boolean(cwd) && enabled,
  });
}
