/**
 * `use-file-transfer` — imperative upload + save-to-disk actions for the Files sidebar
 * (features/file-explorer-transfer.md § Binary transfer frames). Unlike `use-file-download`
 * (which produces view URLs for inline viewers), these are one-shot user-triggered actions; both go
 * through the host's `files` member.
 */

import { useCallback } from "react";
import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import { getHost } from "../host/install.js";
import { type TransferOptions, type UploadSource } from "../host/types.js";

export interface FileTransferActions {
  /** Upload one source to `<dir>/<source.name>` on the daemon, then refresh the explorer. */
  upload(dir: string, source: UploadSource, options?: TransferOptions): Promise<void>;
  /** Copy `path` from the daemon to the user's machine. */
  saveToDisk(path: string): Promise<void>;
}

/** The hook's upload, outside React: host upload, then an explorer refresh. */
export async function uploadAndRefresh(
  queryClient: Pick<QueryClient, "invalidateQueries">,
  dir: string,
  source: UploadSource,
  options?: TransferOptions,
): Promise<void> {
  await getHost().files.upload(dir, source, options);
  // The daemon does not push an explorer update after an upload — invalidate the listing so the
  // new file appears (mirrors `files-changed` invalidation for tool writes).
  await queryClient.invalidateQueries({ queryKey: ["explorer"] });
}

export function useFileTransfer(): FileTransferActions {
  const queryClient = useQueryClient();

  const upload = useCallback(
    (dir: string, source: UploadSource, options?: TransferOptions) =>
      uploadAndRefresh(queryClient, dir, source, options),
    [queryClient],
  );
  const saveToDisk = useCallback((path: string) => getHost().files.saveToDisk(path), []);

  return { upload, saveToDisk };
}
