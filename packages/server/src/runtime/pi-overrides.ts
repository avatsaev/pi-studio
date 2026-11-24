import { AsyncLocalStorage } from "node:async_hooks";

import { identityOf } from "../extensions/pi-source.js";

/**
 * In-process replacements of two Pi behaviours for a daemon running as the single binary
 * (`swe/architecture/single-binary-daemon.md` § Pi's settings, A6, P8, D2).
 *
 * The binary shares the user's Pi folder with a Pi the user runs by hand, so it must not rewrite
 * that Pi's `settings.json` to do its job:
 *
 * 1. Pi's package manager is the `bun` script beside the binary (`SettingsManager.getNpmCommand`),
 *    so `pi install npm:…` works with no npm on the host.
 * 2. `DefaultPackageManager.resolve()` — the one place Pi turns its configured packages into the
 *    extensions, skills and prompts it loads and installs what is missing — leaves out every source
 *    in `excluded`. Only that call is filtered: `addSourceToSettings` and friends still read the
 *    whole list, so a write never drops an entry from the user's settings.
 *
 * Mirrors Pi internals (`dist/core/settings-manager.js`, `dist/core/package-manager.js`, checked at
 * Pi 1.4.0); re-check on a Pi bump (root AGENTS.md § Pi dependency posture). Nothing is written to
 * disk.
 */

/** The shape of Pi's `packages` entries: a source string or an object with a `source`. */
type PackageEntry = string | { source: string };

interface SettingsWithPackages {
  packages?: PackageEntry[];
}

interface SettingsManagerLike {
  prototype: {
    getNpmCommand(): string[] | undefined;
    getGlobalSettings(): SettingsWithPackages;
    getProjectSettings(): SettingsWithPackages;
  };
}

interface PackageManagerLike {
  prototype: {
    resolve(...args: unknown[]): Promise<unknown>;
  };
}

export interface PiOverrideTargets {
  SettingsManager: SettingsManagerLike;
  DefaultPackageManager: PackageManagerLike;
}

export interface PiOverrideOptions {
  /** Absolute path of the `bun` script beside the binary. */
  bunScript: string;
  /** Pi sources (`npm:<name>` / `git:<url>`) to leave out of `resolve()`. */
  excluded: readonly string[];
}

/** Prototypes already patched, so a second call does nothing. */
const patched = new WeakSet<object>();

function sourceOf(entry: PackageEntry): string | undefined {
  if (typeof entry === "string") return entry;
  return typeof entry?.source === "string" ? entry.source : undefined;
}

function identityOrUndefined(source: string): string | undefined {
  try {
    return identityOf(source);
  } catch {
    // Not an `npm:`/`git:` source (a local path): never excluded.
    return undefined;
  }
}

/** The entries of `packages` whose identity is not in `excludedIdentities`. */
export function withoutExcluded(
  packages: PackageEntry[] | undefined,
  excludedIdentities: ReadonlySet<string>,
): PackageEntry[] | undefined {
  if (!packages) return packages;
  return packages.filter((entry) => {
    const source = sourceOf(entry);
    if (source === undefined) return true;
    const identity = identityOrUndefined(source);
    return identity === undefined || !excludedIdentities.has(identity);
  });
}

/**
 * Apply both replacements to Pi's classes. Idempotent per process: the first call wins.
 *
 * `resolve()` runs inside an `AsyncLocalStorage` scope; only the settings reads made inside that
 * scope are filtered, so a concurrent write elsewhere in the daemon sees the real settings.
 */
export function applyPiOverrides(targets: PiOverrideTargets, options: PiOverrideOptions): void {
  const { SettingsManager, DefaultPackageManager } = targets;
  if (patched.has(SettingsManager.prototype)) return;
  patched.add(SettingsManager.prototype);

  const excluded = new Set<string>();
  for (const source of options.excluded) {
    const identity = identityOrUndefined(source);
    if (identity !== undefined) excluded.add(identity);
  }
  const scope = new AsyncLocalStorage<true>();

  SettingsManager.prototype.getNpmCommand = () => [options.bunScript];

  const readGlobal = SettingsManager.prototype.getGlobalSettings;
  const readProject = SettingsManager.prototype.getProjectSettings;
  SettingsManager.prototype.getGlobalSettings = function (this: unknown) {
    const settings = readGlobal.call(this);
    return scope.getStore()
      ? { ...settings, packages: withoutExcluded(settings.packages, excluded) }
      : settings;
  };
  SettingsManager.prototype.getProjectSettings = function (this: unknown) {
    const settings = readProject.call(this);
    return scope.getStore()
      ? { ...settings, packages: withoutExcluded(settings.packages, excluded) }
      : settings;
  };

  const resolve = DefaultPackageManager.prototype.resolve;
  DefaultPackageManager.prototype.resolve = function (this: unknown, ...args: unknown[]) {
    return scope.run(true, () => resolve.apply(this, args));
  };
}
