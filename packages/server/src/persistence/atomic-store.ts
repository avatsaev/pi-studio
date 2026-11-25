import { existsSync } from "node:fs";
import { mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";

import { safeParseOrDefault } from "@av-pi-studio/protocol";
import type { z } from "zod";

import { mapWithConcurrency } from "../util/concurrency.js";

/**
 * File-based JSON store primitives (architecture/persistence.md § Behavior & Algorithms,
 * § Error Handling).
 *
 * Pi-Studio uses file-based JSON persistence instead of a database. Every document is Zod-validated.
 * Most stores write **atomically** (temp file in the same directory, fsync, rename — atomic on
 * POSIX). There is no migration framework:
 * forward-compat is optional fields + defaults.
 */

/** The subdirectories created under `$PI_STUDIO_HOME`. */
export const STORE_SUBDIRECTORIES = ["agents", "projects"] as const;

/**
 * Atomically write `data` to `path`: validate against `schema`, write `{path}.tmp` in the **same
 * directory**, fsync it, then rename over `path`. The rename is atomic on POSIX, so a crash before
 * the rename leaves the previous `path` intact and only discards the temp file.
 */
export async function atomicWriteJson<S extends z.ZodTypeAny>(
  path: string,
  data: z.input<S>,
  schema: S,
): Promise<void> {
  const validated = schema.parse(data) as unknown;
  const json = `${JSON.stringify(validated, null, 2)}\n`;

  await mkdir(dirname(path), { recursive: true });

  // Unique temp name in the same directory so concurrent writers never clobber each other's temp.
  const tmp = `${path}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
  const handle = await open(tmp, "w");
  try {
    await handle.writeFile(json, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }

  try {
    await rename(tmp, path);
  } catch (error) {
    // Clean up the orphaned temp file; never leave it where a loader might trip over it.
    await unlink(tmp).catch(() => undefined);
    throw error;
  }
}

/**
 * Load a JSON store from `path`. Missing file → `defaults`. Corrupt/partial JSON or a schema
 * mismatch → `defaults` (never throws, so the daemon cannot be crashed by a bad file).
 */
export async function loadStore<S extends z.ZodTypeAny>(
  path: string,
  schema: S,
  defaults: z.infer<S>,
): Promise<z.infer<S>> {
  if (!existsSync(path)) return defaults;

  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(path, "utf8"));
  } catch {
    // Corrupt/partial JSON — fall back to defaults rather than crash.
    return defaults;
  }

  return safeParseOrDefault(schema, raw, defaults);
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
