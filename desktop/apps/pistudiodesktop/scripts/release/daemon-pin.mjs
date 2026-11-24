// Writes the pin of the daemon binary the desktop app installs (spec `swe/features/single-binary-daemon.md` § The pin):
//
//   node daemon-pin.mjs --manifest <url> (--min <version> | --min-from <cli_answers.rs>) --out <file> \
//        [--wait-minutes 30]
//
// Reads the manifest `daemon-updates/latest.json` and writes `{ version, assets }` (the four targets,
// each `{ url, sha256, size }`) to `<file>` (`desktop/daemon-pin.json`) when its version is at or above
// the minimum. While the manifest is lower (or cannot be fetched) it retries every 60 s for up to
// `--wait-minutes` (default 0: one attempt, which is how a developer refreshes the committed file),
// then fails with `no daemon binary ≥ <min> is published`. A manifest that is malformed fails at once:
// waiting does not mend it.
//
// The minimum is the app's oldest supported CLI, `MIN_CLI_VERSION` in `desktop/crates/shell/src/cli_answers.rs`
// (what `daemons::min_daemon_version()` returns). `--min-from` reads it from that source so that the
// workflow never repeats the number; `--min` gives it directly.

import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

/** The release targets the pin names (the keys of `scripts/build-binary.mjs`'s `TARGETS`). */
export const TARGETS = ["linux-x64", "linux-arm64", "darwin-arm64", "darwin-x64"];

const PLAIN_VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const SHA256 = /^[0-9a-f]{64}$/;
const RETRY_SECONDS = 60;

/** The numbers of a plain version. */
const parts = (version) => version.split(".").map(Number);

/** Negative, zero or positive as `a` is below, equal to or above `b` (both plain versions). */
export function compareVersions(a, b) {
  const [left, right] = [parts(a), parts(b)];
  for (let i = 0; i < 3; i++) if (left[i] !== right[i]) return left[i] - right[i];
  return 0;
}

/** The `MIN_CLI_VERSION` constant of Rust source text, as `major.minor.patch`. */
export function readMinVersion(source) {
  const match = /pub const MIN_CLI_VERSION: Version = Version \{\s*major: (\d+),\s*minor: (\d+),\s*patch: (\d+),?\s*\};/.exec(source);
  if (match === null) throw new Error("no `pub const MIN_CLI_VERSION: Version = Version { major, minor, patch }` in the source");
  return `${Number(match[1])}.${Number(match[2])}.${Number(match[3])}`;
}

/** The pin (`{ version, assets }`) of a parsed manifest; throws a message when it is not valid. */
export function pinOf(manifest) {
  if (typeof manifest !== "object" || manifest === null || Array.isArray(manifest)) throw new Error("the manifest is not an object");
  const { version, assets } = manifest;
  if (typeof version !== "string" || !PLAIN_VERSION.test(version)) throw new Error("the manifest has no valid `version`");
  if (typeof assets !== "object" || assets === null || Array.isArray(assets)) throw new Error("the manifest has no `assets`");
  const pinned = {};
  for (const target of TARGETS) {
    const asset = assets[target];
    if (typeof asset !== "object" || asset === null) throw new Error(`the manifest has no asset for ${target}`);
    const { url, sha256, size } = asset;
    if (typeof url !== "string" || !/^https?:\/\//.test(url)) throw new Error(`the ${target} asset has no valid \`url\``);
    if (typeof sha256 !== "string" || !SHA256.test(sha256)) throw new Error(`the ${target} asset has no valid \`sha256\``);
    if (!Number.isInteger(size) || size <= 0) throw new Error(`the ${target} asset has no valid \`size\``);
    pinned[target] = { url, sha256, size };
  }
  return { version, assets: pinned };
}

/** A manifest that is not valid, as opposed to one that is not there (yet): not worth retrying. */
class MalformedManifest extends Error {}

/** One attempt: the pin of the manifest at `url`. Throws `MalformedManifest` for bad content, `Error` for a fetch failure. */
async function fetchPin(url) {
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`${url} answered ${response.status}`);
  let manifest;
  try {
    manifest = await response.json();
  } catch {
    throw new MalformedManifest(`${url} is not JSON`);
  }
  try {
    return pinOf(manifest);
  } catch (error) {
    throw new MalformedManifest(error instanceof Error ? error.message : String(error));
  }
}

/**
 * Waits for a manifest at or above `min` and returns its pin.
 * @param {{manifest: string, min: string, waitMinutes?: number, retrySeconds?: number, log?: (line: string) => void}} options
 */
export async function waitForPin({ manifest, min, waitMinutes = 0, retrySeconds = RETRY_SECONDS, log = () => {} }) {
  const deadline = Date.now() + waitMinutes * 60_000;
  let reason = "";
  for (;;) {
    try {
      const pin = await fetchPin(manifest);
      if (compareVersions(pin.version, min) >= 0) return pin;
      reason = `the manifest names ${pin.version}`;
    } catch (error) {
      if (error instanceof MalformedManifest) throw error;
      reason = error instanceof Error ? error.message : String(error);
    }
    if (Date.now() + retrySeconds * 1000 > deadline) {
      throw new Error(`no daemon binary ≥ ${min} is published (${reason})`);
    }
    log(`${reason}; trying again in ${retrySeconds} s`);
    await new Promise((resolve) => setTimeout(resolve, retrySeconds * 1000));
  }
}

const VALUE_OPTIONS = ["manifest", "min", "min-from", "out", "wait-minutes", "retry-seconds"];

/** The options of a command line (`--name value`); `retry-seconds` is for the tests. */
export function parseArgs(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--") || !VALUE_OPTIONS.includes(arg.slice(2))) throw new Error(`unknown argument "${arg}"`);
    const value = argv[++i];
    if (value === undefined) throw new Error(`${arg} needs a value`);
    options[arg.slice(2).replace(/-(\w)/g, (_, c) => c.toUpperCase())] = value;
  }
  for (const required of ["manifest", "out"]) if (options[required] === undefined) throw new Error(`--${required} is required`);
  if ((options.min === undefined) === (options.minFrom === undefined)) throw new Error("exactly one of --min and --min-from is required");
  if (options.min !== undefined && !PLAIN_VERSION.test(options.min)) throw new Error(`--min "${options.min}" is not <major>.<minor>.<patch>`);
  for (const key of ["waitMinutes", "retrySeconds"]) {
    if (options[key] === undefined) continue;
    const number = Number(options[key]);
    if (!Number.isFinite(number) || number < 0) throw new Error(`--${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)} must be a number of at least 0`);
    options[key] = number;
  }
  return options;
}

/** Runs a command line: writes the pin file; returns its path and the pin. */
export async function run(argv, log = () => {}) {
  const { manifest, min, minFrom, out, waitMinutes, retrySeconds } = parseArgs(argv);
  const minimum = min ?? readMinVersion(readFileSync(minFrom, "utf8"));
  const pin = await waitForPin({ manifest, min: minimum, waitMinutes, retrySeconds, log });
  writeFileSync(out, `${JSON.stringify(pin, null, 2)}\n`);
  return { path: out, pin };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const { path, pin } = await run(process.argv.slice(2), (line) => console.log(line));
    console.log(`wrote ${path}: daemon ${pin.version}`);
  } catch (error) {
    console.error(`daemon-pin: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
