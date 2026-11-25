import { join } from "node:path";

import {
  viewerSettingsSchema,
  type ViewerSettings,
  type ViewerSettingsEntry,
  type ViewerSettingsPatchEntry,
} from "@av-pi-studio/protocol";

import type { Logger } from "../logging/logger.js";
import { atomicWriteJson, loadStore } from "../persistence/atomic-store.js";

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
 * Load `viewer-settings.json`. An absent file (the ordinary first-boot state, logged nowhere), or a
 * file that is not JSON or fails the schema → the all-enabled defaults (`{ version: 1, viewers: {} }`).
 * A damaged file is first set aside as `viewer-settings.json.corrupt-<UTC timestamp>` and logged as
 * an error (`loadStore`), so the next `set` writes a fresh file and never overwrites the damaged one.
 * A file that cannot be read at all (permissions, a directory) throws: it is not known to be damaged,
 * and defaults would let the next `set` replace it. The `get` handler then answers with an error,
 * which a client treats like any failed fetch: every viewer stays enabled.
 *
 * Deliberately the **soft-fallback** contract, not `extensions-state.ts`'s `"unreadable"`
 * sentinel: extensions must not silently re-offer a package after a corrupt read (an identity
 * already offered must stay offered), whereas an unreadable viewer setting must degrade toward
 * *offering* the viewer — the same direction every other viewer-settings degrade path takes
 * (absent row, capability-free daemon, failed client fetch all mean "enabled";
 * docs/MOLVIEWER_DECOUPLING.md § 4.4 rules). A corrupt file must never end up hiding a file
 * behind a "which viewer can open this" decision.
 */
export async function loadViewerSettings(home: string, logger: Logger): Promise<ViewerSettings> {
  return loadStore(viewerSettingsPath(home), viewerSettingsSchema, DEFAULT_SETTINGS, logger);
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
