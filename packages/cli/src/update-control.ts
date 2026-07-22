import { execFile } from "node:child_process";
import { createRequire } from "node:module";

/**
 * Self-update process control (features/cli.md § Command tree — top-level `update`). Shells out to
 * the same `npm` the CLI itself was installed with, rather than reimplementing a registry client:
 * this correctly respects the user's npm config (registry mirrors, auth, proxies) and installs the
 * exact same way `npm install -g @av-pi-studio/cli` does, so there is nothing to keep in sync with
 * npm's own install behavior.
 *
 * Side-effecting operations (registry lookup, global install) are injectable so the command layer
 * is unit-testable without touching the network or global npm state.
 */

export const PACKAGE_NAME = "@av-pi-studio/cli";

// Read our own package.json for the current version — same relative layout in both `src/`
// (ts-node/tsx) and `dist/` (compiled — one level below the package root either way).
export const { version: CURRENT_VERSION }: { version: string } = createRequire(import.meta.url)(
  "../package.json",
);

/** Fetch the latest published version of `pkg` from the npm registry, or `null` on any failure. */
export type LatestVersionFetcher = (pkg: string) => Promise<string | null>;

/** Install `pkg@version` globally. Throws on failure. */
export type GlobalInstaller = (pkg: string, version: string) => Promise<void>;

export interface UpdateRuntime {
  getLatestVersion: LatestVersionFetcher;
  installGlobal: GlobalInstaller;
}

/** Default latest-version fetcher: `npm view <pkg> version`. */
export const npmLatestVersion: LatestVersionFetcher = (pkg) =>
  new Promise((resolve) => {
    execFile("npm", ["view", pkg, "version"], { timeout: 15_000 }, (err, stdout) => {
      if (err) {
        resolve(null);
        return;
      }
      const version = stdout.trim();
      resolve(version || null);
    });
  });

/** Default global installer: `npm install -g <pkg>@<version>`. */
export const npmGlobalInstaller: GlobalInstaller = (pkg, version) =>
  new Promise((resolve, reject) => {
    execFile(
      "npm",
      ["install", "-g", `${pkg}@${version}`],
      { timeout: 120_000 },
      (err, _stdout, stderr) => {
        if (err) {
          reject(new Error(stderr.trim() || err.message));
          return;
        }
        resolve();
      },
    );
  });

export function defaultUpdateRuntime(): UpdateRuntime {
  return { getLatestVersion: npmLatestVersion, installGlobal: npmGlobalInstaller };
}

/**
 * Compare two `x.y.z` version strings (numeric per-segment; missing segments treat as 0).
 * Returns negative/zero/positive like `Array.prototype.sort`'s comparator. Not a full semver
 * comparator (no prerelease/build-metadata handling) — this monorepo only ever publishes plain
 * `major.minor.patch` releases (`scripts/publish.sh`), so that's the only shape this needs to
 * handle correctly.
 */
export function compareVersions(a: string, b: string): number {
  const partsA = a.split(".").map((n) => Number(n) || 0);
  const partsB = b.split(".").map((n) => Number(n) || 0);
  const len = Math.max(partsA.length, partsB.length);
  for (let i = 0; i < len; i++) {
    const diff = (partsA[i] ?? 0) - (partsB[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}
