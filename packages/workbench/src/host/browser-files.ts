/**
 * The browser host's `files`: today's in-memory paths. Uploads read the `File`'s bytes, save-to-disk
 * downloads into memory and clicks a download anchor, and viewers get a `Blob` object URL.
 */

import { type FileTransferClient } from "@av-pi-studio/client";
import { type HostFiles, type UploadSource, type ViewableFile } from "./types.js";

/** `Blob`'s DOM typings require an `ArrayBuffer`-backed view; the assembled `Uint8Array`'s
 *  `ArrayBufferLike` backing doesn't satisfy that on its own, so copy first. */
function toBlob(bytes: Uint8Array, mimeType?: string): Blob {
  return new Blob([Uint8Array.from(bytes)], { type: mimeType || "application/octet-stream" });
}

export function createBrowserFiles(transfer: () => FileTransferClient): HostFiles {
  return {
    async upload(dir: string, source: UploadSource): Promise<void> {
      if (!(source instanceof Blob)) {
        throw new Error("the browser host can only upload File/Blob sources");
      }
      const target = dir ? `${dir}/${source.name}` : source.name;
      await transfer().upload(target, new Uint8Array(await source.arrayBuffer()));
    },

    async saveToDisk(path: string): Promise<void> {
      const file = await transfer().download(path);
      const url = URL.createObjectURL(toBlob(file.bytes, file.mimeType));
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
      const file = await transfer().download(path);
      const url = URL.createObjectURL(toBlob(file.bytes, file.mimeType));
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
