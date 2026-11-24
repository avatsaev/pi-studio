import { createRequire } from "node:module";

import {
  type GlobalInstaller,
  type LatestVersionFetcher,
  npmGlobalInstall,
  npmLatestVersion,
} from "@av-pi-studio/server";

/**
 * Self-update process control (features/cli.md § Command tree — top-level `update`). The engine
 * itself (npm lookup, version comparison, the global install with its ENOTEMPTY self-heal) lives
 * in `@av-pi-studio/server`'s `update/` modules (features/self-update.md § Where the code lives);
 * this file keeps the CLI's injectable `UpdateRuntime` seam and its own current version.
 */
export { PACKAGE_NAME, compareVersions } from "@av-pi-studio/server";
export type { GlobalInstaller, LatestVersionFetcher } from "@av-pi-studio/server";

// Read our own package.json for the current version — same relative layout in both `src/`
// (ts-node/tsx) and `dist/` (compiled — one level below the package root either way).
export const { version: CURRENT_VERSION }: { version: string } = createRequire(import.meta.url)(
  "../package.json",
);

export interface UpdateRuntime {
  getLatestVersion: LatestVersionFetcher;
  installGlobal: GlobalInstaller;
}

export function defaultUpdateRuntime(): UpdateRuntime {
  return { getLatestVersion: npmLatestVersion, installGlobal: npmGlobalInstall };
}
