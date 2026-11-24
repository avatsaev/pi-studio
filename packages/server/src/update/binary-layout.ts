import { constants } from "node:fs";
import { access, mkdir, readdir, rename, rm, symlink } from "node:fs/promises";
import { join, relative, sep } from "node:path";

/**
 * The binary's folder layout under `$PI_STUDIO_HOME` (swe/features/single-binary-daemon.md
 * § 3) and the filesystem steps that move between versions:
 *
 * ```
 * bin/versions/<version>/pi-studio   one folder per installed version
 * bin/current -> versions/<version>  symbolic link, switched by rename
 * bin/tmp/                           downloads and unpacking
 * ```
 */

export const BINARY_NAME = "pi-studio";

const PLAIN_VERSION = /^\d+\.\d+\.\d+$/;

export function binDir(home: string): string {
  return join(home, "bin");
}

export function versionsDir(home: string): string {
  return join(binDir(home), "versions");
}

export function versionDir(home: string, version: string): string {
  return join(versionsDir(home), version);
}

export function binaryTmpDir(home: string): string {
  return join(binDir(home), "tmp");
}

/** The link the app and the command-line tool run through: `bin/current`. */
export function currentLink(home: string): string {
  return join(binDir(home), "current");
}

/** The executable of one installed version. */
export function versionExecutable(home: string, version: string): string {
  return join(versionDir(home, version), BINARY_NAME);
}

/** The executable the link points at: `bin/current/pi-studio`. */
export function currentExecutable(home: string): string {
  return join(currentLink(home), BINARY_NAME);
}

/**
 * The version of an executable that sits at `<versions>/<version>/pi-studio`, else `null`. Both
 * paths are compared as given: resolve symbolic links first.
 */
export function managedVersionOf(versions: string, executable: string): string | null {
  const parts = relative(versions, executable).split(sep);
  const [version, name, ...rest] = parts;
  if (version === undefined || name !== BINARY_NAME || rest.length > 0) return null;
  return PLAIN_VERSION.test(version) ? version : null;
}

/**
 * Point `bin/current` at `versions/<version>`: a symbolic link `current.new` is created beside it
 * and renamed over it, so `current` is never missing or half-written. Throws, leaving `current`
 * untouched, when the version's executable is missing.
 */
export async function switchCurrent(home: string, version: string): Promise<void> {
  await access(versionExecutable(home, version), constants.X_OK);
  const link = currentLink(home);
  const staging = `${link}.new`;
  await rm(staging, { recursive: true, force: true });
  await symlink(join("versions", version), staging);
  await rename(staging, link);
}

/** Every installed version folder name (a folder under `bin/versions`). */
export async function installedVersions(home: string): Promise<string[]> {
  try {
    const entries = await readdir(versionsDir(home), { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
}

/** Remove every version folder (and stray file) of `bin/versions` that is not in `keep`. */
export async function pruneVersions(home: string, keep: readonly string[]): Promise<string[]> {
  let names: string[];
  try {
    names = await readdir(versionsDir(home));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
  const removed: string[] = [];
  for (const name of names) {
    if (keep.includes(name)) continue;
    await rm(join(versionsDir(home), name), { recursive: true, force: true });
    removed.push(name);
  }
  return removed;
}

/** An empty `bin/tmp`: whatever an earlier install left is removed. */
export async function resetTmpDir(home: string): Promise<string> {
  const dir = binaryTmpDir(home);
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  return dir;
}
