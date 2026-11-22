/**
 * The Files sidebar's upload flow, outside React: confirm overwrites, then upload one source at a
 * time as one activity of the transfer-activity store (one percentage, one Cancel — D11). The
 * outcome lands in the store as its last result.
 */

import { type TransferOptions, type UploadSource } from "../../host/types.js";
import { isAbortError, useTransferActivityStore } from "../../stores/transfer-activity-store.js";

export interface UploadSourcesDeps {
  /** Names already present in the target directory. */
  existing: ReadonlySet<string>;
  confirm(message: string): Promise<boolean>;
  upload(dir: string, source: UploadSource, options?: TransferOptions): Promise<void>;
}

const plural = (n: number): string => `${n} file${n > 1 ? "s" : ""}`;

/** The whole batch's progress in whole percent, or `null` when any source's size is unknown. */
export function batchPercent(
  sources: readonly UploadSource[],
  index: number,
  sentInCurrent: number,
): number | null {
  let total = 0;
  let done = 0;
  for (const [i, source] of sources.entries()) {
    if (source.size === undefined) return null;
    total += source.size;
    if (i < index) done += source.size;
  }
  if (total <= 0) return null;
  return Math.min(100, Math.floor(((done + sentInCurrent) / total) * 100));
}

export async function uploadSources(
  dir: string,
  sources: readonly UploadSource[],
  deps: UploadSourcesDeps,
): Promise<void> {
  if (!sources.length || !dir) return;
  const clashes = sources.filter((s) => deps.existing.has(s.name));
  if (clashes.length > 0) {
    const names = clashes.map((s) => s.name).join(", ");
    const overwrite = await deps.confirm(
      `Overwrite ${clashes.length > 1 ? "these files" : "this file"}? ${names}`,
    );
    if (!overwrite) return;
  }

  const store = useTransferActivityStore.getState();
  // One controller for the batch: Cancel aborts the file being sent, and the loop starts no more.
  const controller = new AbortController();
  const id = store.add({
    kind: "upload",
    label: `Uploading ${plural(sources.length)}`,
    cancel: () => controller.abort(),
  });
  let filesSent = 0;
  try {
    for (const [index, source] of sources.entries()) {
      if (controller.signal.aborted) break;
      await deps.upload(dir, source, {
        signal: controller.signal,
        // A progress call means the file is moving: it ends a "waiting" after a restart.
        onProgress: (sent) =>
          store.update(id, { percent: batchPercent(sources, index, sent), state: "running" }),
        onStateChange: (state) => store.update(id, { state }),
      });
      filesSent++;
    }
    // A Cancel that lands after the last file settled changes nothing: the batch is complete.
    store.remove(
      id,
      filesSent < sources.length
        ? { text: "Upload cancelled", error: false }
        : { text: `Uploaded ${plural(sources.length)}`, error: false },
    );
  } catch (e) {
    store.remove(
      id,
      controller.signal.aborted || isAbortError(e)
        ? { text: "Upload cancelled", error: false }
        : { text: `Upload failed: ${e instanceof Error ? e.message : "unknown"}`, error: true },
    );
  }
}
