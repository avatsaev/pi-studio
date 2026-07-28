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

/** Thrown by `useFileRead` when the server rejects a read with `error: "file_too_large"`
 *  (`file_read_response`, `MAX_INLINE_FILE_READ_BYTES` server-side). Carries `size` and the
 *  server's own `maxBytes` ceiling so a caller can render an accurate message and decide whether
 *  to fall back to the streaming path (`use-file-text.ts`) instead of just displaying the string
 *  `"file_too_large"`. */
export class FileTooLargeError extends Error {
  readonly size: number;
  readonly maxBytes?: number;

  constructor(size: number, maxBytes?: number) {
    super("file_too_large");
    this.name = "FileTooLargeError";
    this.size = size;
    this.maxBytes = maxBytes;
  }
}

export interface FileReadRpcResponse {
  ok: boolean;
  content?: string;
  size?: number;
  maxBytes?: number;
  error?: string;
}

/** Maps a raw `file_read_response` into a result or a thrown error — pure, so the
 *  `file_too_large` classification (the actual behavior change in this task) is directly
 *  unit-testable without a connected client or React. */
export function parseFileReadResponse(response: FileReadRpcResponse): FileReadResult {
  if (!response.ok) {
    if (response.error === "file_too_large") {
      throw new FileTooLargeError(response.size ?? 0, response.maxBytes);
    }
    throw new Error(response.error ?? "file read failed");
  }
  return { content: response.content ?? "", size: response.size ?? 0 };
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
      return parseFileReadResponse(response);
    },
    enabled: Boolean(client) && Boolean(path) && enabled,
  });
}
