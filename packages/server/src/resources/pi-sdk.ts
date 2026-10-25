import {
  DefaultPackageManager,
  loadSkillsFromDir,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import type { LoadSkillsResult, PackageSource } from "@earendil-works/pi-coding-agent";

/**
 * The single importer of Pi's `SettingsManager`, `DefaultPackageManager`, and `loadSkillsFromDir`
 * (swe/architecture/pi-resource-management.md § Public contract — `pi-sdk.ts`). A Pi bump has
 * exactly one place to check for this feature's symbols. Mirrors the in-process-import precedent
 * in `agent/provider-auth/pi-auth-runtime.ts`, except this one imports eagerly: the daemon already
 * pays for `@earendil-works/pi-coding-agent`'s module graph via
 * `agent/providers/pi/session-hydration.ts` (`SessionManager`), so there is no boot-resilience
 * reason to defer it here.
 */

export { loadSkillsFromDir };
export type { LoadSkillsResult, PackageSource };

/** Pi's two resource managers for one `agentDir`, freshly constructed per operation (never
 *  cached across calls — `swe/architecture/pi-resource-management.md` tenet 1: no cache). */
export interface PiResources {
  /** Reloaded from disk — reflects the current `<agentDir>/settings.json` and
   *  `<cwd>/.pi/settings.json`, not whatever a prior instance observed. */
  settings: SettingsManager;
  packages: DefaultPackageManager;
}

/** Construct a fresh `SettingsManager`/`DefaultPackageManager` pair for `agentDir`, reloading
 *  settings from disk first so every caller sees the current file, never a stale in-memory copy
 *  from an earlier `SettingsManager.create()` elsewhere in the process. */
export async function openPiResources(agentDir: string, cwd: string): Promise<PiResources> {
  const settings = SettingsManager.create(cwd, agentDir);
  await settings.reload();
  const packages = new DefaultPackageManager({ cwd, agentDir, settingsManager: settings });
  return { settings, packages };
}
