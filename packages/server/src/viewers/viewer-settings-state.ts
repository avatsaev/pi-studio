import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import {
  viewerSettingsSchema,
  type ViewerSettings,
  type ViewerSettingsEntry,
  type ViewerSettingsPatchEntry,
} from "@av-pi-studio/protocol";

import type { Logger } from "../logging/logger.js";
import { atomicWriteJson } from "../persistence/atomic-store.js";

/**
 * `$PI_STUDIO_HOME/viewer-settings.json` — the durable, per-viewer enable/disable document
 * (docs/MOLVIEWER_DECOUPLING.md § 4.4). The daemon has zero plugin knowledge: rows are keyed by
 * whatever id a client sends (no id enum, ever) and `config` is an opaque blob it never
 * interprets — § 3's dependency rule (core never knows a specific plugin) applied to persistence.
 */

export type ViewerSettingsPatch = Record<string, ViewerSettingsPatchEntry>;

const DEFAULT_SETTINGS: ViewerSettings = { version: 1, viewers: {} };

export function viewerSettingsPath(home: string): string {
  return join(home, "viewer-settings.json");
}

/**
 * Load `viewer-settings.json`. Absent file, corrupt/partial JSON, or a schema mismatch → the
 * all-enabled defaults (`{ version: 1, viewers: {} }`), with a `warn` log on a read failure
 * (never on a merely-absent file — that is the ordinary first-boot state).
 *
 * Deliberately the **soft-fallback** contract, not `extensions-state.ts`'s `"unreadable"`
 * sentinel: extensions must not silently re-offer a package after a corrupt read (an identity
 * already offered must stay offered), whereas an unreadable viewer setting must degrade toward
 * *offering* the viewer — the same direction every other viewer-settings degrade path takes
 * (absent row, capability-free daemon, failed client fetch all mean "enabled";
 * docs/MOLVIEWER_DECOUPLING.md § 4.4 rules). A corrupt file must never end up hiding a file
 * behind a "which viewer can open this" decision.
 *
 * Hand-rolled (mirroring `extensions-state.ts`'s own manual read+parse) rather than the generic
 * `loadStore` helper, which has no hook to log a distinct warning on a read failure versus an
 * ordinary missing file.
 */
export async function loadViewerSettings(home: string, logger?: Logger): Promise<ViewerSettings> {
  const path = viewerSettingsPath(home);
  if (!existsSync(path)) return DEFAULT_SETTINGS;

  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    logger?.warn(
      { err: (error as Error)?.message ?? String(error) },
      "viewer-settings.json is corrupt JSON; degrading to all-enabled defaults",
    );
    return DEFAULT_SETTINGS;
  }

  const parsed = viewerSettingsSchema.safeParse(raw);
  if (!parsed.success) {
    logger?.warn(
      { issues: parsed.error.issues },
      "viewer-settings.json failed schema validation; degrading to all-enabled defaults",
    );
    return DEFAULT_SETTINGS;
  }
  return parsed.data;
}

export async function saveViewerSettings(home: string, settings: ViewerSettings): Promise<void> {
  await atomicWriteJson(viewerSettingsPath(home), settings, viewerSettingsSchema);
}

/**
 * Pure per-viewer merge: a patch entry's present fields overwrite, absent fields are preserved
 * from the current row. A viewer id not present in `current` is created, `enabled` defaulting to
 * `true` when the patch omits it (absent-row-means-enabled applies to a brand new row too). No
 * deletion semantics — a patch never removes a row.
 */
export function applyViewerSettingsPatch(
  current: ViewerSettings,
  patch: ViewerSettingsPatch,
): ViewerSettings {
  const viewers = { ...current.viewers };
  for (const [id, entryPatch] of Object.entries(patch)) {
    const existing = viewers[id];
    const entry: ViewerSettingsEntry = {
      enabled: entryPatch.enabled ?? existing?.enabled ?? true,
    };
    const config = entryPatch.config ?? existing?.config;
    if (config !== undefined) entry.config = config;
    viewers[id] = entry;
  }
  return { version: current.version, viewers };
}
