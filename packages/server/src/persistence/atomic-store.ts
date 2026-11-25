import { existsSync } from "node:fs";
import { mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import type { z } from "zod";

import type { Logger } from "../logging/logger.js";
import { mapWithConcurrency } from "../util/concurrency.js";

/**
 * File-based JSON store primitives (architecture/persistence.md § Behavior & Algorithms,
 * § Error Handling).
 *
 * Pi-Studio uses file-based JSON persistence instead of a database. Every document is Zod-validated.
 * Most stores write **atomically** (temp file in the same directory, fsync, rename — atomic on
 * POSIX), one write per path at a time. A file that cannot be read back is **set aside**
 * (`<name>.corrupt-<UTC timestamp>`), never overwritten. There is no migration framework:
 * forward-compat is optional fields + defaults.
 */

/** The subdirectories created under `$PI_STUDIO_HOME`. */
export const STORE_SUBDIRECTORIES = ["agents", "projects"] as const;

/** The last write queued for each path (by resolved path); the entry goes when the queue drains. */
const writeTails = new Map<string, Promise<unknown>>();

/**
 * Atomically write `data` to `path`: validate against `schema`, write `{path}.tmp` in the **same
 * directory**, fsync it, then rename over `path`. The rename is atomic on POSIX, so a crash before
 * the rename leaves the previous `path` intact and only discards the temp file.
 *
 * Writes to one path run one at a time, in call order: the last call wins. `data` is validated and
 * serialised when called, so a later change to it cannot reach a queued write. A failed write
 * rejects its own caller and does not stop the writes queued behind it.
 */
export async function atomicWriteJson<S extends z.ZodTypeAny>(
  path: string,
  data: z.input<S>,
  schema: S,
): Promise<void> {
  const validated = schema.parse(data) as unknown;
  const json = `${JSON.stringify(validated, null, 2)}\n`;

  const key = resolve(path);
  const run = (writeTails.get(key) ?? Promise.resolve()).then(() =>
    writeFileAtomically(path, json),
  );
  const tail = run.catch(() => undefined);
  writeTails.set(key, tail);
  try {
    await run;
  } finally {
    if (writeTails.get(key) === tail) writeTails.delete(key);
  }
}

async function writeFileAtomically(path: string, json: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });

  // Unique temp name in the same directory: another process (the CLI) may write the same file.
  const tmp = `${path}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
  try {
    const handle = await open(tmp, "w");
    try {
      await handle.writeFile(json, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(tmp, path);
  } catch (error) {
    // Never leave an orphaned temp file where a loader might trip over it.
    await unlink(tmp).catch(() => undefined);
    throw error;
  }
}

/** `20261125T143012Z`: a UTC timestamp that is a valid file name on every platform. */
function fileTimestamp(date: Date): string {
  return date
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
}

/**
 * Set a damaged file aside: rename it to `<name>.corrupt-<UTC timestamp>` (with `-1`, `-2`… added when
 * that name is taken, so an earlier set-aside file is never replaced), log an error with the path and
 * the reason, and return the new path. A rename that fails throws: a file that cannot be set aside
 * must not be replaced.
 */
export async function quarantineFile(
  path: string,
  reason: string,
  logger: Logger,
): Promise<string> {
  const base = `${path}.corrupt-${fileTimestamp(new Date())}`;
  let target = base;
  for (let n = 1; existsSync(target); n++) target = `${base}-${n}`;

  await rename(path, target);
  logger.error({ path, quarantinedTo: target, reason }, "damaged file set aside");
  return target;
}

/** The first few schema issues of a failed parse, as one line for the log. */
function describeIssues(error: z.ZodError): string {
  const shown = error.issues
    .slice(0, 3)
    .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`);
  const more = error.issues.length - shown.length;
  return `schema mismatch: ${shown.join("; ")}${more > 0 ? `; and ${more} more` : ""}`;
}

/**
 * Load a JSON store from `path`. A missing file → `defaults`, silently. A file that does not parse
 * or fails `schema` is set aside with {@link quarantineFile} (logged as an error), then `defaults`
 * are returned: the next save writes a fresh file and the damaged one stays on disk. A file that
 * cannot be read at all (permissions, a directory) throws: it is not known to be damaged, and
 * returning defaults would let the next save replace it.
 */
export async function loadStore<S extends z.ZodTypeAny>(
  path: string,
  schema: S,
  defaults: z.infer<S>,
  logger: Logger,
): Promise<z.infer<S>> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return defaults;
    throw error;
  }

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    await quarantineFile(path, `invalid JSON: ${detail}`, logger);
    return defaults;
  }

  const parsed = schema.safeParse(raw);
  if (parsed.success) return parsed.data as z.infer<S>;
  await quarantineFile(path, describeIssues(parsed.error), logger);
  return defaults;
}

/**
 * Create the `$PI_STUDIO_HOME` directory layout (`agents/`, `projects/`). Idempotent — safe to
 * call on every boot.
 */
export async function ensureDirectoryLayout(home: string): Promise<string> {
  await mkdir(home, { recursive: true });
  await mapWithConcurrency(STORE_SUBDIRECTORIES, (sub) =>
    mkdir(join(home, sub), { recursive: true }),
  );
  return home;
}
