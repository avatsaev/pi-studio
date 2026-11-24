import {
  type GlobalInstaller,
  type LatestVersionFetcher,
  npmGlobalInstall,
  npmLatestVersion,
} from "@av-pi-studio/server";

import { PACKAGE_VERSION } from "./version.generated.js";

/**
 * Self-update process control (features/cli.md § Command tree — top-level `update`). The engine
 * itself (npm lookup, version comparison, the global install with its ENOTEMPTY self-heal) lives
 * in `@av-pi-studio/server`'s `update/` modules (features/self-update.md § Where the code lives);
 * this file keeps the CLI's injectable `UpdateRuntime` seam and its own current version.
 */
export { PACKAGE_NAME, compareVersions } from "@av-pi-studio/server";
export type { GlobalInstaller, LatestVersionFetcher } from "@av-pi-studio/server";

// This package's own version, generated from its package.json by `scripts/gen-version.mjs`.
export const CURRENT_VERSION: string = PACKAGE_VERSION;

export interface UpdateRuntime {
  getLatestVersion: LatestVersionFetcher;
  installGlobal: GlobalInstaller;
}

export function defaultUpdateRuntime(): UpdateRuntime {
  return { getLatestVersion: npmLatestVersion, installGlobal: npmGlobalInstall };
}
