/**
 * The Files sidebar's upload flow, outside React: confirm overwrites, upload one source at a time,
 * and report progress and the outcome on the explorer's status line.
 */

import { type TransferOptions, type UploadSource } from "../../host/types.js";

export interface UploadStatus {
  text: string;
  error: boolean;
}

export interface UploadSourcesDeps {
  /** Names already present in the target directory. */
  existing: ReadonlySet<string>;
  confirm(message: string): Promise<boolean>;
  upload(dir: string, source: UploadSource, options?: TransferOptions): Promise<void>;
  setStatus(status: UploadStatus): void;
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

  const uploading = `Uploading ${plural(sources.length)}…`;
  deps.setStatus({ text: uploading, error: false });
  // The SDK reports every chunk; the status line only changes when the percentage does.
  let shown = -1;
  try {
    for (const [index, source] of sources.entries()) {
      await deps.upload(dir, source, {
        onProgress: (sent) => {
          const percent = batchPercent(sources, index, sent);
          if (percent === null || percent === shown) return;
          shown = percent;
          deps.setStatus({ text: `${uploading} ${percent}%`, error: false });
        },
      });
    }
    deps.setStatus({ text: `Uploaded ${plural(sources.length)}`, error: false });
  } catch (e) {
    deps.setStatus({
      text: `Upload failed: ${e instanceof Error ? e.message : "unknown"}`,
      error: true,
    });
  }
}
