/**
 * The browser host's `files`: uploads hand the `File` itself to the SDK (sliced and paced there, so a
 * large upload never sits in memory), downloads collect the SDK's chunks straight into a `Blob`
 * (never one concatenated array), save-to-disk clicks a download anchor, and viewers get a `Blob`
 * object URL.
 */

import { type FileTransferClient } from "@av-pi-studio/client";
import {
  type HostFiles,
  type SaveTarget,
  type TransferOptions,
  type UploadSource,
  type ViewableFile,
} from "./types.js";

/** Bytes per ranged request when saving into a target (chosen, not measured). */
const SAVE_RANGE_BYTES = 8 * 1024 * 1024;

/** Throws what a save rejects with once its signal has aborted, whichever step notices. */
function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new DOMException("The save was aborted", "AbortError");
}

/**
 * Stream `path` into `target`, one range at a time, awaiting every write. `onProgress` gets the
 * bytes written so far and the file's size. An abort is noticed before each range and each write
 * (and inside a range by the SDK); the target is then discarded, never finished.
 */
async function saveIntoTarget(
  client: FileTransferClient,
  path: string,
  target: SaveTarget,
  options: TransferOptions | undefined,
): Promise<void> {
  const signal = options?.signal;
  try {
    let offset = 0;
    let written = 0;
    let ifUnchanged: { size: number; mtimeMs: number } | undefined;
    for (;;) {
      throwIfAborted(signal);
      const chunks: Uint8Array[] = [];
      const info = await client.downloadTo(path, (chunk) => void chunks.push(chunk), {
        offset,
        length: SAVE_RANGE_BYTES,
        ...(ifUnchanged ? { ifUnchanged } : {}),
        ...(signal ? { signal } : {}),
      });
      ifUnchanged ??= { size: info.totalBytes, mtimeMs: info.mtimeMs };
      for (const chunk of chunks) {
        throwIfAborted(signal);
        await target.write(chunk);
        written += chunk.length;
        options?.onProgress?.(written, info.totalBytes);
      }
      offset += info.length;
      if (offset >= info.totalBytes) {
        if (written === 0) options?.onProgress?.(0, info.totalBytes); // an empty file
        break;
      }
      if (info.length === 0) throw new Error("the daemon returned no bytes before the end of file");
    }
    throwIfAborted(signal);
    await target.finish();
  } catch (error) {
    await target.discard().catch(() => {});
    throw error;
  }
}

/**
 * Download `path` into a `Blob` built from the chunks as they arrive. The SDK keeps no reference to
 * a chunk once the sink returns, so holding them until the `Blob` exists is the intended use. The
 * request has no range, so the SDK's progress length is the file's size.
 */
async function downloadAsBlob(
  client: FileTransferClient,
  path: string,
  options?: TransferOptions,
): Promise<{ blob: Blob; fileName?: string; mimeType?: string }> {
  const chunks: Uint8Array[] = [];
  const info = await client.downloadTo(path, (chunk) => void chunks.push(chunk), {
    ...(options?.signal ? { signal: options.signal } : {}),
    ...(options?.onProgress ? { onProgress: options.onProgress } : {}),
  });
  // The chunks are views on received WebSocket messages, which are always `ArrayBuffer`-backed;
  // `Blob`'s DOM typings cannot see that through `ArrayBufferLike`.
  const blob = new Blob(chunks as BlobPart[], {
    type: info.mimeType || "application/octet-stream",
  });
  return { blob, fileName: info.fileName, mimeType: info.mimeType };
}

export function createBrowserFiles(
  transfer: () => FileTransferClient,
  saveTarget?: (suggestedName: string) => Promise<SaveTarget | null>,
): HostFiles {
  return {
    async upload(dir: string, source: UploadSource, options?: TransferOptions): Promise<void> {
      if (!(source instanceof Blob)) {
        throw new Error("the browser host can only upload File/Blob sources");
      }
      const target = dir ? `${dir}/${source.name}` : source.name;
      // The Blob itself, never `arrayBuffer()`: the SDK slices it chunk by chunk. An abort
      // rejects with the SDK's `AbortError`. The host never reports a state: it is always running.
      await transfer().upload(target, source, {
        onProgress: options?.onProgress,
        signal: options?.signal,
      });
    },

    async saveToDisk(path: string, options?: TransferOptions): Promise<void> {
      throwIfAborted(options?.signal);
      if (saveTarget) {
        // Neither callback runs before this answer: the user has not chosen a destination yet.
        const target = await saveTarget(path.split("/").pop() || "download");
        if (target) await saveIntoTarget(transfer(), path, target, options);
        return;
      }
      const file = await downloadAsBlob(transfer(), path, options);
      throwIfAborted(options?.signal); // an abort that raced the last chunk saves nothing
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
