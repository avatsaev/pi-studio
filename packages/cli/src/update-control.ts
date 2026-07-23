import { execFile } from "node:child_process";
import { rm } from "node:fs/promises";
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
 *
 * `npmGlobalInstaller` also self-heals npm's own `ENOTEMPTY` rename-collision bug: npm's arborist
 * computes each package's rename-during-swap staging directory as a deterministic hash of its
 * install path (`@npmcli/arborist`'s `retire-path.js`) and only removes it after a *successful*
 * install. An install interrupted mid-swap (killed, crashed, network drop) leaves that directory
 * behind non-empty, and every subsequent `npm install -g` collides with the exact same path and
 * fails with `ENOTEMPTY: directory not empty, rename '<pkg>' -> '<staging dir>'` forever, until a
 * human manually deletes it. We detect that specific failure, remove the staging directory npm
 * itself reported, and retry — this is the same self-repair a human would do by hand.
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
export const npmLatestVersion: LatestVersionFetcher = (pkg) => {
  const { promise, resolve } = Promise.withResolvers<string | null>();
  execFile("npm", ["view", pkg, "version"], { timeout: 15_000 }, (err, stdout) => {
    if (err) {
      resolve(null);
      return;
    }
    resolve(stdout.trim() || null);
  });
  return promise;
};

/** Matches npm's ENOTEMPTY rename-collision message and captures the blocking staging directory
 *  (module doc above explains why it's left behind and why removing it is safe). */
const ENOTEMPTY_RENAME = /ENOTEMPTY: directory not empty, rename '.+?' -> '(.+?)'/;

/** Extract the stale staging directory from an ENOTEMPTY rename-collision error message, or
 *  `null` if the message doesn't match that failure. */
export function staleStagingDirFrom(message: string): string | null {
  return ENOTEMPTY_RENAME.exec(message)?.[1] ?? null;
}

/**
 * Run `install`; on an ENOTEMPTY staging-dir collision, remove the stale directory it reports via
 * `removeStaleDir` and retry, up to `maxRetries` times, instead of surfacing npm's cryptic rename
 * error for the user to fix by hand.
 */
export async function installWithStaleStagingRetry(
  install: () => Promise<void>,
  removeStaleDir: (path: string) => Promise<void>,
  maxRetries = 3,
): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await install();
      return;
    } catch (err) {
      const stale = staleStagingDirFrom((err as Error).message);
      if (!stale || attempt >= maxRetries) throw err;
      await removeStaleDir(stale);
    }
  }
}

function runNpmInstall(pkg: string, version: string): Promise<void> {
  const { promise, resolve, reject } = Promise.withResolvers<void>();
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
  return promise;
}

/** Default global installer: `npm install -g <pkg>@<version>`, self-healing a stale npm staging
 *  directory left behind by a previous interrupted install (module doc above). */
export const npmGlobalInstaller: GlobalInstaller = (pkg, version) =>
  installWithStaleStagingRetry(
    () => runNpmInstall(pkg, version),
    (path) => rm(path, { recursive: true, force: true }),
  );

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
