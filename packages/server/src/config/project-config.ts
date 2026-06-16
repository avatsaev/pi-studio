import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { z } from "zod";

/**
 * Per-project `pi-studio.json` config — architecture/config.md § Per-project config,
 * features/worktrees.md § Lifecycle config, features/service-proxy.md § Triggering.
 *
 * Holds worktree lifecycle commands (`setup`/`teardown`) and named `scripts` (a `type:"service"`
 * script is proxied). A stale-write revision model guards concurrent edits.
 */

// ---------------------------------------------------------------------------
// Schema + normalization
// ---------------------------------------------------------------------------

/** Normalize a `string | string[] | undefined` command list: split to array, drop blanks. */
function toCommandList(value: string | string[] | undefined): string[] {
  const list = value === undefined ? [] : Array.isArray(value) ? value : [value];
  return list.map((entry) => entry.trim()).filter((entry) => entry.length > 0);
}

const commandsInputSchema = z.union([z.string(), z.array(z.string())]).optional();

/** Worktree lifecycle block — `setup`/`teardown` normalized to deduped command arrays. */
const worktreeConfigSchema = z
  .object({ setup: commandsInputSchema, teardown: commandsInputSchema })
  .transform((w) => ({ setup: toCommandList(w.setup), teardown: toCommandList(w.teardown) }));

/**
 * A named script entry. `command` is required; `type:"service"` flags it for the service proxy.
 * Extra fields are tolerated (full script-entry schema is TODO(verify)).
 */
export const scriptEntrySchema = z
  .object({
    type: z.string().optional(),
    command: z.string(),
  })
  .passthrough();
export type ScriptEntry = z.infer<typeof scriptEntrySchema>;

/** True when a script should be registered with the service proxy. */
export function isServiceScript(entry: ScriptEntry): boolean {
  return entry.type === "service";
}

export const piStudioConfigSchema = z.object({
  worktree: worktreeConfigSchema.default({}),
  scripts: z.record(z.string(), scriptEntrySchema).default({}),
  instructions: z.string().optional(),
});
export type PiStudioConfig = z.infer<typeof piStudioConfigSchema>;

/** Parse + normalize a raw `pi-studio.json` document. Throws on invalid input. */
export function normalizeProjectConfig(raw: unknown): PiStudioConfig {
  return piStudioConfigSchema.parse(raw ?? {});
}

// ---------------------------------------------------------------------------
// Revision / stale-write model
// ---------------------------------------------------------------------------

/** Revision token of a `pi-studio.json` (content hash). `null` means "no file on disk". */
export const piStudioConfigRevisionSchema = z.string().nullable();
export type PiStudioConfigRevision = z.infer<typeof piStudioConfigRevisionSchema>;

export type ProjectConfigWriteError =
  | "project_not_found"
  | "invalid_project_config"
  | "stale_project_config"
  | "write_failed";

/** Compute the revision token for the given file contents (sha256 hex). */
export function computeRevision(contents: string): string {
  return createHash("sha256").update(contents).digest("hex");
}

async function currentRevision(path: string): Promise<PiStudioConfigRevision> {
  if (!existsSync(path)) return null;
  return computeRevision(await readFile(path, "utf8"));
}

export interface ReadProjectConfigResult {
  config: PiStudioConfig;
  /** `null` when no `pi-studio.json` exists (project has no per-project config yet). */
  revision: PiStudioConfigRevision;
}

/**
 * Read + normalize `pi-studio.json`. A missing file yields the default (empty) config with a `null`
 * revision; corrupt/invalid JSON yields defaults too (read is lenient — the write path enforces
 * validity).
 */
export async function readProjectConfig(path: string): Promise<ReadProjectConfigResult> {
  if (!existsSync(path)) return { config: normalizeProjectConfig({}), revision: null };
  const contents = await readFile(path, "utf8");
  let parsed: PiStudioConfig;
  try {
    parsed = normalizeProjectConfig(JSON.parse(contents));
  } catch {
    parsed = normalizeProjectConfig({});
  }
  return { config: parsed, revision: computeRevision(contents) };
}

export type WriteProjectConfigResult =
  | { ok: true; revision: string; config: PiStudioConfig }
  | { ok: false; error: ProjectConfigWriteError };

/**
 * Write `pi-studio.json` under the optimistic-concurrency revision model. Returns a typed error:
 * - `project_not_found` — the project root directory does not exist.
 * - `invalid_project_config` — `newConfig` fails schema validation.
 * - `stale_project_config` — the on-disk file changed since `expectedRevision` was read.
 * - `write_failed` — the filesystem write threw.
 */
export async function writeProjectConfig(
  path: string,
  newConfig: unknown,
  expectedRevision: PiStudioConfigRevision,
): Promise<WriteProjectConfigResult> {
  if (!existsSync(dirname(path))) return { ok: false, error: "project_not_found" };

  const parsed = piStudioConfigSchema.safeParse(newConfig);
  if (!parsed.success) return { ok: false, error: "invalid_project_config" };

  const onDisk = await currentRevision(path);
  if (expectedRevision !== onDisk) return { ok: false, error: "stale_project_config" };

  try {
    const contents = `${JSON.stringify(newConfig, null, 2)}\n`;
    await writeFile(path, contents, "utf8");
    return { ok: true, revision: computeRevision(contents), config: parsed.data };
  } catch {
    return { ok: false, error: "write_failed" };
  }
}
