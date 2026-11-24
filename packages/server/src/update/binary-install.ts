import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { access, mkdir, mkdtemp, open, readdir, rename, rm } from "node:fs/promises";
import { join } from "node:path";

import {
  BINARY_NAME,
  resetTmpDir,
  versionDir,
  versionExecutable,
  versionsDir,
} from "./binary-layout.js";
import type { BinaryAsset } from "./binary-manifest.js";
import { extractTarGz } from "./tar-extract.js";

/**
 * Installing one version of the binary into `bin/versions/<version>` (swe/features/self-update.md
 * § Apply, Binary): download the system's archive into `bin/tmp` (60 s without data fails),
 * verify its SHA-256, unpack it without letting an entry leave the folder, run the unpacked
 * `pi-studio --version` and require the target, then move the folder into place. Every failure
 * throws with the reason and leaves `bin/current` and the other versions untouched.
 */

/** A download that receives nothing for this long fails (`timeout`). */
export const DOWNLOAD_STALL_MS = 60_000;

/** How long `pi-studio --version` of a new version may take. */
export const VERSION_CHECK_TIMEOUT_MS = 15_000;

export interface BinaryInstallOptions {
  home: string;
  version: string;
  asset: BinaryAsset;
  fetchFn?: typeof fetch;
  stallMs?: number;
  /** Prints what `<executable> --version` writes; the default runs it (15 s). */
  runVersion?: (executable: string) => Promise<string>;
}

/** The text of an error with the OS or network code that explains it (`fetch failed` hides it). */
function describeError(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const cause: unknown = err.cause;
  const code =
    typeof cause === "object" && cause !== null && "code" in cause && typeof cause.code === "string"
      ? cause.code
      : undefined;
  return code !== undefined ? `${err.message} (${code})` : err.message;
}

/** `<executable> --version`'s trimmed output; rejects when it does not run or exits non-zero. */
export function runExecutableVersion(executable: string): Promise<string> {
  const { promise, resolve, reject } = Promise.withResolvers<string>();
  execFile(
    executable,
    ["--version"],
    { timeout: VERSION_CHECK_TIMEOUT_MS },
    (err, stdout, stderr) => {
      if (err) reject(new Error(`${err.message}\n${stderr}`.trim()));
      else resolve(stdout.trim());
    },
  );
  return promise;
}

/**
 * Downloads `asset` to `file`, hashing as it goes. Fails on an HTTP status other than 2xx, a
 * stall of `stallMs`, more bytes than the manifest announced, or a SHA-256 that is not the
 * manifest's.
 */
export async function downloadAsset(
  asset: BinaryAsset,
  file: string,
  fetchFn: typeof fetch = fetch,
  stallMs: number = DOWNLOAD_STALL_MS,
): Promise<void> {
  const controller = new AbortController();
  let stalled = false;
  let timer: NodeJS.Timeout | undefined;
  const arm = (): void => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      stalled = true;
      controller.abort();
    }, stallMs);
  };
  const hash = createHash("sha256");
  let received = 0;
  const handle = await open(file, "w", 0o600);
  try {
    arm();
    const res = await fetchFn(asset.url, { signal: controller.signal });
    if (!res.ok) throw new Error(`download failed: HTTP ${res.status}`);
    if (res.body === null) throw new Error("download failed: empty answer");
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      arm();
      received += value.length;
      if (received > asset.size) {
        throw new Error(`download failed: more than the announced ${asset.size} bytes`);
      }
      hash.update(value);
      await handle.write(value);
    }
  } catch (err) {
    if (stalled) {
      throw new Error(`download timed out after ${stallMs / 1000} s without data`, { cause: err });
    }
    throw new Error(
      err instanceof Error && err.message.startsWith("download failed")
        ? err.message
        : `download failed: ${describeError(err)}`,
      { cause: err },
    );
  } finally {
    clearTimeout(timer);
    await handle.close();
  }
  if (received !== asset.size) {
    throw new Error(`download failed: ${received} bytes received, ${asset.size} announced`);
  }
  const actual = hash.digest("hex");
  if (actual !== asset.sha256) {
    throw new Error(`checksum mismatch: expected ${asset.sha256}, got ${actual}`);
  }
}

function pathExists(path: string): Promise<boolean> {
  return access(path, constants.F_OK).then(
    () => true,
    () => false,
  );
}

/** The unpacked version folder: the folder itself, or the one folder inside it that holds the binary. */
async function findUnpackedRoot(dir: string): Promise<string> {
  if (await pathExists(join(dir, BINARY_NAME))) return dir;
  const entries = await readdir(dir, { withFileTypes: true });
  const folders = entries.filter((e) => e.isDirectory());
  const [only] = folders;
  if (
    only !== undefined &&
    folders.length === 1 &&
    (await pathExists(join(dir, only.name, BINARY_NAME)))
  ) {
    return join(dir, only.name);
  }
  throw new Error(`the archive holds no ${BINARY_NAME} executable`);
}

/**
 * Installs `version` into `bin/versions/<version>` and returns its executable. An existing folder
 * of that name (a broken earlier install) is replaced.
 */
export async function installBinaryVersion(options: BinaryInstallOptions): Promise<string> {
  const { home, version, asset } = options;
  const runVersion = options.runVersion ?? runExecutableVersion;
  const tmp = await resetTmpDir(home);
  try {
    const archive = join(tmp, `pi-studio-${version}.tar.gz`);
    await downloadAsset(asset, archive, options.fetchFn, options.stallMs);
    const unpackDir = await mkdtemp(join(tmp, "unpack-"));
    await extractTarGz(archive, unpackDir);
    const root = await findUnpackedRoot(unpackDir);
    const executable = join(root, BINARY_NAME);
    let reported: string;
    try {
      reported = await runVersion(executable);
    } catch (err) {
      throw new Error(`the new ${BINARY_NAME} does not run: ${describeError(err)}`, { cause: err });
    }
    if (reported !== version) {
      throw new Error(`the new ${BINARY_NAME} reports version "${reported}", expected ${version}`);
    }
    await mkdir(versionsDir(home), { recursive: true });
    await rm(versionDir(home, version), { recursive: true, force: true });
    await rename(root, versionDir(home, version));
    return versionExecutable(home, version);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}
