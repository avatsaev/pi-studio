import { readFile, rm } from "node:fs/promises";
import { basename, isAbsolute } from "node:path";
import { z } from "zod";

import { atomicWriteJson } from "../persistence/atomic-store.js";

/** The name of an upload's temporary file. The journal never removes a file named otherwise. */
export const UPLOAD_TEMP_NAME = /^\.pistudio-upload-[0-9a-f]{32}\.part$/;

const journalSchema = z.object({ version: z.literal(1), files: z.array(z.string()) }).passthrough();

/**
 * `$PI_STUDIO_HOME/pending-uploads.json`: the temporary files of the uploads in progress. An upload
 * is listed before its temporary file is created and dropped once that file is renamed or removed.
 * A daemon that dies mid-upload leaves its temporary file; the next daemon removes every listed
 * file when the journal is created (`swept`), before recording anything new.
 */
export class UploadJournal {
  /** Settles with the number of leftover files removed at start. */
  readonly swept: Promise<number>;
  private readonly files = new Set<string>();
  /** Writes run one after another, each with the set as it is when the write runs. */
  private writes: Promise<void>;

  constructor(private readonly path: string) {
    this.swept = sweep(path);
    this.writes = this.swept.then(() => undefined);
  }

  /** List `file`; resolves once the journal on disk holds it (or the write failed). */
  add(file: string): Promise<void> {
    this.files.add(file);
    return this.save();
  }

  /** Drop `file` from the list. */
  remove(file: string): Promise<void> {
    return this.files.delete(file) ? this.save() : this.writes;
  }

  private save(): Promise<void> {
    // A journal that cannot be written costs only the cleanup after a crash: uploads go on.
    this.writes = this.writes
      .then(() => atomicWriteJson(this.path, { version: 1, files: [...this.files] }, journalSchema))
      .catch(() => {});
    return this.writes;
  }
}

/** Remove the files a previous daemon listed, then the journal itself. */
async function sweep(path: string): Promise<number> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    return 0; // absent (the usual case) or unreadable
  }
  let listed: string[] = [];
  try {
    const parsed = journalSchema.safeParse(JSON.parse(raw));
    if (parsed.success) listed = parsed.data.files;
  } catch {
    // Not JSON: nothing to remove, and the file is replaced below.
  }
  let removed = 0;
  for (const file of listed) {
    if (!isAbsolute(file) || !UPLOAD_TEMP_NAME.test(basename(file))) continue;
    try {
      await rm(file);
      removed++;
    } catch {
      // Already gone (the upload completed or was removed before the journal was written).
    }
  }
  await rm(path, { force: true }).catch(() => {});
  return removed;
}
