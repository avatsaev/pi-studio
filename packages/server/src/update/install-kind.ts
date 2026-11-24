import { execFile } from "node:child_process";
import { constants, existsSync, readFileSync, realpathSync } from "node:fs";
import { access } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import type { DaemonUpdateInstallKind } from "@av-pi-studio/protocol";

import { isBinary } from "../runtime/self.js";

/**
 * How this daemon was installed, and whether that install can update itself
 * (features/self-update.md § Install kind, § Check). Detection is found once at start by the
 * caller; every probe is injectable so tests never touch the real npm or filesystem.
 */
export type InstallKind = DaemonUpdateInstallKind;

export const INSTALL_KIND_ENV = "PI_STUDIO_INSTALL_KIND";

const INSTALL_KINDS: readonly InstallKind[] = ["npm-global", "docker", "source", "unknown"];

/**
 * Why an install cannot update (`cannot_update.reason`). `unmanaged_binary` is the compiled binary
 * until the binary's own update path lands (sprint-142/task-004 replaces the blocker below by the
 * `bin/versions` check).
 */
export type CannotUpdateReason =
  | "docker"
  | "source"
  | "unknown_install"
  | "npm_missing"
  | "not_writable"
  | "unsupported_platform"
  | "unmanaged_binary";

/** Filesystem seams for `detectInstallKind`. */
export interface InstallKindFs {
  exists(path: string): boolean;
  readText(path: string): string;
  /** Resolve symlinks; return the input unchanged when it cannot be resolved. */
  realpath(path: string): string;
}

const REAL_FS: InstallKindFs = {
  exists: existsSync,
  readText: (path) => readFileSync(path, "utf8"),
  realpath: (path) => {
    try {
      return realpathSync(path);
    } catch {
      return path;
    }
  },
};

function isInside(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
}

/** Nearest ancestor directory of `file` that holds a package.json, or `null`. */
function packageDirOf(file: string, fs: InstallKindFs): string | null {
  for (let dir = dirname(file); ; dir = dirname(dir)) {
    if (fs.exists(join(dir, "package.json"))) return dir;
    if (dirname(dir) === dir) return null;
  }
}

function isWorkspaceRoot(dir: string, fs: InstallKindFs): boolean {
  try {
    const pkg = JSON.parse(fs.readText(join(dir, "package.json"))) as { workspaces?: unknown };
    return pkg.workspaces !== undefined;
  } catch {
    return false;
  }
}

/**
 * Find the install kind. Order: `PI_STUDIO_INSTALL_KIND` (a valid value wins); the compiled binary
 * → `binary` (a build-time constant, `isBinary`); the server package inside `npm root -g` →
 * `npm-global`; the package is `<root>/packages/server` of a workspace root → `source`; else
 * `unknown`.
 *
 * @param selfUrl `import.meta.url` of a module inside the server package.
 * @param npmRoot resolves `npm root -g`, `null` when npm is unavailable.
 * @param binary whether this process is the compiled binary.
 */
export async function detectInstallKind(
  env: NodeJS.ProcessEnv,
  selfUrl: string,
  npmRoot: () => Promise<string | null>,
  fs: InstallKindFs = REAL_FS,
  binary: boolean = isBinary,
): Promise<InstallKind> {
  const forced = env[INSTALL_KIND_ENV];
  const kind = INSTALL_KINDS.find((k) => k === forced);
  if (kind) return kind;
  if (binary) return "binary";

  const self = fs.realpath(fileURLToPath(selfUrl));
  const root = await npmRoot();
  if (root && isInside(fs.realpath(root), self)) return "npm-global";

  const pkgDir = packageDirOf(self, fs);
  if (pkgDir && basename(pkgDir) === "server" && basename(dirname(pkgDir)) === "packages") {
    if (isWorkspaceRoot(dirname(dirname(pkgDir)), fs)) return "source";
  }
  return "unknown";
}

let cachedRoot: Promise<string | null> | undefined;

/** `npm root -g`, or `null` when npm is missing or fails. Cached for the process lifetime. */
export function npmRootGlobal(): Promise<string | null> {
  if (!cachedRoot) {
    const { promise, resolve } = Promise.withResolvers<string | null>();
    execFile("npm", ["root", "-g"], { timeout: 15_000 }, (err, stdout) => {
      resolve(err ? null : stdout.trim() || null);
    });
    cachedRoot = promise;
  }
  return cachedRoot;
}

/** True when the current process can write to npm's global folder (`null` folder → false). */
export async function canWriteGlobalFolder(
  folder: string | null,
  checkAccess: (path: string, mode: number) => Promise<void> = access,
): Promise<boolean> {
  if (!folder) return false;
  try {
    await checkAccess(folder, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

/** True when an `npm` executable runs (`npm --version` succeeds). */
export function npmOnPath(): Promise<boolean> {
  const { promise, resolve } = Promise.withResolvers<boolean>();
  execFile("npm", ["--version"], { timeout: 10_000 }, (err) => resolve(!err));
  return promise;
}

/** The reason this install cannot update by kind and platform, or `null` when it can. */
export function updateBlocker(
  kind: InstallKind,
  platform: NodeJS.Platform,
): CannotUpdateReason | null {
  switch (kind) {
    case "docker":
      return "docker";
    case "source":
      return "source";
    case "unknown":
      return "unknown_install";
    case "binary":
      return "unmanaged_binary";
    case "npm-global":
      return platform === "win32" ? "unsupported_platform" : null;
  }
}
