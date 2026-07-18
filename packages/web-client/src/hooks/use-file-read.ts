/**
 * `use-file-read` — TanStack Query wrapper over `file_read_request` (POC `loadFileContent`,
 * POC_TO_APP_PLAN_UI.md §4.5 / §3 `hooks/use-file-read.ts`).
 */

import { useQuery } from "@tanstack/react-query";
import { useConnectionStore } from "@pi-studio-ui/lib/connection/connection-store.js";
import { rpcKeys } from "@pi-studio-ui/lib/connection/rpc-keys.js";

export interface FileReadResult {
  content: string;
  size: number;
}

interface FileReadRpcResponse {
  ok: boolean;
  content?: string;
  size?: number;
  error?: string;
}

export function useFileRead(path: string, enabled = true) {
  const client = useConnectionStore((s) => s.client);

  return useQuery({
    queryKey: rpcKeys.fileRead(path),
    queryFn: async (): Promise<FileReadResult> => {
      if (!client) throw new Error("not connected");
      const response = await client.connection.request<FileReadRpcResponse>("file_read_request", {
        path,
      });
      if (!response.ok) throw new Error(response.error ?? "file read failed");
      return { content: response.content ?? "", size: response.size ?? 0 };
    },
    enabled: Boolean(client) && Boolean(path) && enabled,
  });
}
