/**
 * The Files sidebar's upload flow, outside React: confirm overwrites, upload one source at a time,
 * and report progress and the outcome on the explorer's status line.
 */

import { type UploadSource } from "../../host/types.js";

export interface UploadStatus {
  text: string;
  error: boolean;
}

export interface UploadSourcesDeps {
  /** Names already present in the target directory. */
  existing: ReadonlySet<string>;
  confirm(message: string): Promise<boolean>;
  upload(dir: string, source: UploadSource): Promise<void>;
  setStatus(status: UploadStatus): void;
}

const plural = (n: number): string => `${n} file${n > 1 ? "s" : ""}`;

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

  deps.setStatus({ text: `Uploading ${plural(sources.length)}…`, error: false });
  try {
    for (const source of sources) await deps.upload(dir, source);
    deps.setStatus({ text: `Uploaded ${plural(sources.length)}`, error: false });
  } catch (e) {
    deps.setStatus({
      text: `Upload failed: ${e instanceof Error ? e.message : "unknown"}`,
      error: true,
    });
  }
}
