import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import { z } from "zod";

import type { PersistedConfig } from "../config/daemon-config.js";
import { atomicWriteJson } from "../persistence/atomic-store.js";
import { resolvePiAgentDir } from "../agent/provider-registry.js";

/**
 * `$PI_STUDIO_HOME/extensions-state.json` — per-pi-home sync bookkeeping
 * (swe/features/preinstalled-extensions.md § State file), plus the shared "effective pi-home"
 * derivation the sync planner/executor key their state on.
 *
 * `offered` records intent, not presence: an identity enters it only after a successful
 * `pi install`, and once present is never installed again (tenet 1 — a user's later `pi remove`
 * sticks forever). `failures` survives restarts so `failed` + `reason` stay reportable after a
 * reboot; it is diagnostics, never a retry gate.
 */

const offeredEntrySchema = z
  .object({
    /** What sync last wrote, verbatim — the byte-compare ancestor for the ownership rule. */
    installedSpec: z.string(),
    /** Aligned workspace version at install time (diagnostics only; sync never branches on it). */
    atVersion: z.string(),
    at: z.string(),
  })
  .passthrough();

const failureEntrySchema = z
  .object({
    source: z.string(),
    reason: z.string(),
    message: z.string(),
    attempts: z.number(),
    at: z.string(),
  })
  .passthrough();

const lastSyncSummarySchema = z
  .object({
    at: z.string(),
    outcome: z.string(),
  })
  .passthrough();

const piHomeStateSchema = z
  .object({
    offered: z.record(z.string(), offeredEntrySchema).default({}),
    failures: z.record(z.string(), failureEntrySchema).default({}),
    lastSync: lastSyncSummarySchema.optional(),
  })
  .passthrough();

const extensionsStateSchema = z
  .object({
    version: z.literal(1).default(1),
    piHomes: z.record(z.string(), piHomeStateSchema).default({}),
  })
  .passthrough();

export type ExtensionsState = z.infer<typeof extensionsStateSchema>;

/** Per-pi-home slice — the sync planner's `state` input (task 004). */
export type PiHomeState = ExtensionsState["piHomes"][string];

export function extensionsStatePath(home: string): string {
  return join(home, "extensions-state.json");
}

/**
 * Load `extensions-state.json`. Absent file → a valid empty state (`version: 1`, no pi-homes).
 * Malformed JSON or a schema mismatch → the literal string `"unreadable"`, **never** an empty
 * state and **never** a rewrite of the file — callers apply the spec's fail-safe (treat every
 * manifest identity as already offered; wrong-and-quiet beats wrong-and-mutating).
 */
export async function loadExtensionsState(home: string): Promise<ExtensionsState | "unreadable"> {
  const path = extensionsStatePath(home);
  if (!existsSync(path)) return extensionsStateSchema.parse({});

  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(path, "utf8"));
  } catch {
    return "unreadable";
  }

  const parsed = extensionsStateSchema.safeParse(raw);
  return parsed.success ? parsed.data : "unreadable";
}

export async function saveExtensionsState(home: string, state: ExtensionsState): Promise<void> {
  await atomicWriteJson(extensionsStatePath(home), state, extensionsStateSchema);
}

/**
 * The directory spawned agents actually receive as `PI_CODING_AGENT_DIR` — the state key
 * everything in this feature is keyed on. Delegates entirely to {@link resolvePiAgentDir} (the one
 * shared derivation with the spawn path in `agent/provider-registry.ts`, which itself `~`-expands
 * and absolutizes both non-default branches) and applies Pi's own default when neither an override
 * nor `daemon.piHome` is set. No `resolve()` here: re-resolving an already-absolute path is a
 * no-op for the two real branches, and applying it only to the default branch (as this function
 * used to do to *both*) is exactly what let this key diverge from the spawn path for a relative or
 * `~`-prefixed `daemon.piHome` — the two must derive from the same already-absolute value, not
 * each apply their own normalization.
 */
export function effectivePiHomeKey(config: PersistedConfig): string {
  return resolvePiAgentDir(config) ?? join(homedir(), ".pi", "agent");
}
