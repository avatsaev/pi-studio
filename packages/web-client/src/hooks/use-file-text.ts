/**
 * `use-file-text` — tier-2 fallback for `TextViewer` (task-009): decodes a file's bytes to UTF-8
 * text via the already-uncapped chunked binary download path (`useFileDownload` →
 * `file_download_token_request`/`file_download_request`), for files over `file_read_request`'s
 * inline cap (`MAX_INLINE_FILE_READ_BYTES`, `packages/server/src/files/limits.ts`). Same
 * transport the molecule viewer uses for its own (binary-safe) source — no new RPC, no new
 * transport, just a text decode over the resulting blob.
 *
 * Note the daemon asymmetry documented on `useFileDownload`'s own RPCs: the download path is
 * registered only in the production bootstrap (`bootstrap.ts`), not `dev-bootstrap.ts`. Under
 * `npm run dev:daemon` a file above the inline cap fails this fetch rather than rendering — that
 * surfaces as the normal error state below, which is the intended behavior (see task-009 notes).
 *
 * The loading/error/data merge across the two dependent queries (download → decode) is the pure,
 * DOM-free `mergeFileTextState` (`file-text-state.ts`) — this hook is a thin wrapper feeding it
 * live query state.
 */

import { useQuery } from "@tanstack/react-query";
import { rpcKeys } from "@pi-studio-ui/lib/connection/rpc-keys.js";
import { useFileDownload } from "./use-file-download.js";
import { mergeFileTextState, type FileTextResult } from "./file-text-state.js";

export type { FileTextResult };

export function useFileText(path: string, enabled = true) {
  const download = useFileDownload(path, enabled);
  const objectUrl = download.data?.objectUrl;

  const decode = useQuery({
    queryKey: rpcKeys.fileText(path),
    queryFn: async (): Promise<FileTextResult> => {
      const content = await (await fetch(objectUrl as string)).text();
      return { content };
    },
    enabled: enabled && Boolean(objectUrl),
  });

  return mergeFileTextState({
    enabled,
    download: {
      isLoading: download.isLoading,
      isError: download.isError,
      error: download.error,
      hasObjectUrl: Boolean(objectUrl),
    },
    decode: {
      isLoading: decode.isLoading,
      isError: decode.isError,
      error: decode.error,
      data: decode.data,
    },
  });
}
