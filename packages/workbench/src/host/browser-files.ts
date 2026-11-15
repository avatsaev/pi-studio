/**
 * The browser host's `files`: uploads hand the `File` itself to the SDK (sliced and paced there, so a
 * large upload never sits in memory), downloads collect the SDK's chunks straight into a `Blob`
 * (never one concatenated array), save-to-disk clicks a download anchor, and viewers get a `Blob`
 * object URL.
 */

import { type FileTransferClient } from "@av-pi-studio/client";
import {
  type HostFiles,
  type UploadOptions,
  type UploadSource,
  type ViewableFile,
} from "./types.js";

/**
 * Download `path` into a `Blob` built from the chunks as they arrive. The SDK keeps no reference to
 * a chunk once the sink returns, so holding them until the `Blob` exists is the intended use.
 */
async function downloadAsBlob(
  client: FileTransferClient,
  path: string,
): Promise<{ blob: Blob; fileName?: string; mimeType?: string }> {
  const chunks: Uint8Array[] = [];
  const info = await client.downloadTo(path, (chunk) => void chunks.push(chunk));
  // The chunks are views on received WebSocket messages, which are always `ArrayBuffer`-backed;
  // `Blob`'s DOM typings cannot see that through `ArrayBufferLike`.
  const blob = new Blob(chunks as BlobPart[], {
    type: info.mimeType || "application/octet-stream",
  });
  return { blob, fileName: info.fileName, mimeType: info.mimeType };
}

export function createBrowserFiles(transfer: () => FileTransferClient): HostFiles {
  return {
    async upload(dir: string, source: UploadSource, options?: UploadOptions): Promise<void> {
      if (!(source instanceof Blob)) {
        throw new Error("the browser host can only upload File/Blob sources");
      }
      const target = dir ? `${dir}/${source.name}` : source.name;
      // The Blob itself, never `arrayBuffer()`: the SDK slices it chunk by chunk.
      await transfer().upload(target, source, { onProgress: options?.onProgress });
    },

    async saveToDisk(path: string): Promise<void> {
      const file = await downloadAsBlob(transfer(), path);
      const url = URL.createObjectURL(file.blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = file.fileName || path.split("/").pop() || "download";
      anchor.rel = "noopener";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      // Revoke on the next tick — some browsers need the URL alive until the click is processed.
      setTimeout(() => URL.revokeObjectURL(url), 0);
    },

    async openForView(path: string): Promise<ViewableFile> {
      const file = await downloadAsBlob(transfer(), path);
      const url = URL.createObjectURL(file.blob);
      let released = false;
      return {
        url,
        ...(file.mimeType ? { mimeType: file.mimeType } : {}),
        ...(file.fileName ? { fileName: file.fileName } : {}),
        release() {
          if (released) return;
          released = true;
          URL.revokeObjectURL(url);
        },
      };
    },
  };
}
