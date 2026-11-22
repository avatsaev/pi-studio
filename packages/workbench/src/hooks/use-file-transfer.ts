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
import { isAbortError, useTransferActivityStore } from "../stores/transfer-activity-store.js";
import { percentOf } from "../stores/transfer-activity-text.js";

export interface FileTransferActions {
  /** Upload one source to `<dir>/<source.name>` on the daemon, then refresh the explorer. */
  upload(dir: string, source: UploadSource, options?: TransferOptions): Promise<void>;
  /**
   * Copy `path` from the daemon to the user's machine, as an activity of the transfer-activity
   * store. A cancel rejects with the host's `AbortError`, so a caller can tell it from a failure.
   */
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

/**
 * The hook's save, outside React. The host gets a signal and both callbacks; the activity appears at
 * the host's first `onProgress` or `onStateChange` (a host says nothing while the user is still in
 * the save dialog) and goes when the call settles, leaving its outcome as the store's last result.
 * A call that settles without ever calling back (the user dismissed the dialog) leaves no result.
 */
export async function saveToDiskActivity(path: string): Promise<void> {
  const store = useTransferActivityStore.getState();
  const name = path.split("/").pop() || path;
  const controller = new AbortController();
  // An object, not a `let`: the callbacks assign it, and the code after the `await` reads it.
  const activity: { id: string | null } = { id: null };
  const begin = (): string =>
    (activity.id ??= store.add({
      kind: "save",
      label: `Downloading ${name}`,
      cancel: () => controller.abort(),
    }));
  try {
    await getHost().files.saveToDisk(path, {
      signal: controller.signal,
      // A progress call means the file is moving: it ends a "waiting" after a restart.
      onProgress: (done, total) =>
        store.update(begin(), { percent: percentOf(done, total), state: "running" }),
      onStateChange: (state) => store.update(begin(), { state }),
    });
    if (activity.id) store.remove(activity.id, { text: `Downloaded ${name}`, error: false });
  } catch (e) {
    if (controller.signal.aborted || isAbortError(e)) {
      if (activity.id) store.remove(activity.id, { text: "Download cancelled", error: false });
    } else {
      const outcome = {
        text: `Download failed: ${e instanceof Error ? e.message : "unknown"}`,
        error: true,
      };
      if (activity.id) store.remove(activity.id, outcome);
      else store.report(outcome);
    }
    throw e;
  }
}

export function useFileTransfer(): FileTransferActions {
  const queryClient = useQueryClient();

  const upload = useCallback(
    (dir: string, source: UploadSource, options?: TransferOptions) =>
      uploadAndRefresh(queryClient, dir, source, options),
    [queryClient],
  );
  return { upload, saveToDisk: saveToDiskActivity };
}
