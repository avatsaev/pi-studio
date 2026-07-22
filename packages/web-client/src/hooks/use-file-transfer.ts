/**
 * `use-file-transfer` — imperative upload + save-to-disk actions for the Files sidebar
 * (features/file-explorer-transfer.md § Binary transfer frames). Unlike `use-file-download`
 * (which produces object URLs for inline viewers), these are one-shot user-triggered actions:
 * push local bytes to the daemon, or pull daemon bytes into a browser file-save.
 */

import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useConnectionStore } from "@pi-studio-ui/lib/connection/connection-store.js";
import { transferFor } from "./file-transfer-instance.js";

/** Trigger a browser "save file" for the bytes assembled from a daemon-side path. */
function saveBlob(bytes: Uint8Array, fileName: string, mimeType?: string): void {
  const blob = new Blob([Uint8Array.from(bytes)], {
    type: mimeType || "application/octet-stream",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Revoke on the next tick — some browsers need the URL alive until the click is processed.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export interface FileTransferActions {
  /** Upload one browser `File` to `<dir>/<file.name>` on the daemon. */
  upload(dir: string, file: File): Promise<void>;
  /** Download `path` from the daemon and save it via the browser. */
  saveToDisk(path: string): Promise<void>;
}

export function useFileTransfer(): FileTransferActions {
  const daemon = useConnectionStore((s) => s.daemon);
  const queryClient = useQueryClient();

  const upload = useCallback(
    async (dir: string, file: File) => {
      if (!daemon) throw new Error("not connected");
      const target = dir ? `${dir}/${file.name}` : file.name;
      const bytes = new Uint8Array(await file.arrayBuffer());
      await transferFor(daemon).upload(target, bytes);
      // The daemon does not push an explorer update after an upload — invalidate the listing so
      // the new file appears (mirrors `files-changed` invalidation for tool writes).
      await queryClient.invalidateQueries({ queryKey: ["explorer"] });
    },
    [daemon, queryClient],
  );

  const saveToDisk = useCallback(
    async (path: string) => {
      if (!daemon) throw new Error("not connected");
      const file = await transferFor(daemon).download(path);
      saveBlob(file.bytes, file.fileName || path.split("/").pop() || "download", file.mimeType);
    },
    [daemon],
  );

  return { upload, saveToDisk };
}
