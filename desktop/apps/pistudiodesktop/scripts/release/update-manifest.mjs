// Turns a directory of signed release files into the updater's static manifest.
//
//   node update-manifest.mjs --dir <files> --version <N> --base-url <asset URL prefix> \
//        --release-url <release page> [--self-check] [--require <kinds>] [--pub-date <RFC 3339>] [--out <file>]
//
// Without `--self-check` it writes `latest.json`, the manifest naming N. With it, it writes
// `self-check.json`: the same files under the version `<N's next patch>-selfcheck`, which is greater
// than N, so that N can be offered an update to its own files (spec U6). The manifest is the plug-in's
// static format; the plug-in's own `RemoteRelease` reads it (`src-tauri/tests/update_manifest.rs`).
//
// Each update file is found by its suffix and must have a `<name>.sig` next to it. The self check
// reads `<name>.selfcheck.sig` instead: the plug-in compares the version in a signature's trusted
// comment with the manifest's version, so the files are signed a second time for the self-check
// version (`tauri signer sign --app-version <version> -f <key> <file>`; the publishing job keeps the
// result as `<file>.selfcheck.sig`).
//
// The asset URL is `<base-url>/<asset name>`, where the asset name is the file name as GitHub stores
// it: GitHub replaces each space of an uploaded file's name with a dot (`Pi Studio.app.tar.gz` becomes
// `Pi.Studio.app.tar.gz`), and a name with any other character GitHub may rewrite is refused.

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const SELF_CHECK_SIGNATURE_SUFFIX = ".selfcheck.sig";

/** The command that makes a file's self-check signature, for the error message. */
const signCommand = (version, file) => `tauri signer sign --app-version ${version} -f <key> ${file}, kept as ${file}${SELF_CHECK_SIGNATURE_SUFFIX}`;

/**
 * The kinds of update file, in manifest order: the file's suffix and the updater targets it serves.
 * The macOS file is the one universal bundle, so it serves both architectures (spec P3).
 */
export const KINDS = {
  appimage: { suffix: ".AppImage", targets: ["linux-x86_64-appimage"] },
  deb: { suffix: ".deb", targets: ["linux-x86_64-deb"] },
  rpm: { suffix: ".rpm", targets: ["linux-x86_64-rpm"] },
  app: { suffix: ".app.tar.gz", targets: ["darwin-aarch64", "darwin-x86_64"] },
  nsis: { suffix: "-setup.exe", targets: ["windows-x86_64-nsis"] },
  msi: { suffix: ".msi", targets: ["windows-x86_64-msi"] },
};

const SIGNATURE_SUFFIX = ".sig";
const SELF_CHECK_TAG = "selfcheck";
const PLAIN_VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
/** The characters GitHub keeps in an asset name. */
const ASSET_NAME = /^[A-Za-z0-9._-]+$/;

/** The version the self check offers: N's next patch with the tag, which orders after N (semver). */
export function selfCheckVersion(version) {
  const parts = PLAIN_VERSION.exec(version);
  if (!parts) throw new Error(`--version must be major.minor.patch, got "${version}"`);
  return `${parts[1]}.${parts[2]}.${Number(parts[3]) + 1}-${SELF_CHECK_TAG}`;
}

/** The name GitHub gives an uploaded file: each space becomes a dot. */
export function assetName(fileName) {
  const name = fileName.replaceAll(" ", ".");
  if (!ASSET_NAME.test(name)) throw new Error(`"${fileName}" has a character GitHub may rewrite in an asset name; cannot form its URL`);
  return name;
}

/** The asset URL of `fileName` below `baseUrl`. */
export function assetUrl(baseUrl, fileName) {
  return `${baseUrl.replace(/\/+$/, "")}/${encodeURIComponent(assetName(fileName))}`;
}

/** The kinds named by a comma-separated `--require` value. */
export function parseKinds(text) {
  const kinds = text.split(",").map((kind) => kind.trim());
  const unknown = kinds.filter((kind) => !(kind in KINDS));
  if (unknown.length > 0 || kinds.length === 0) {
    throw new Error(`--require names kinds from ${Object.keys(KINDS).join(", ")}; got "${unknown.join(", ") || text}"`);
  }
  return kinds;
}

/** The one file of `names` that ends with `suffix`, or `undefined`; two is an error. */
function findBySuffix(names, kind) {
  const found = names.filter((name) => name.endsWith(KINDS[kind].suffix));
  if (found.length > 1) throw new Error(`more than one ${kind} update file (${KINDS[kind].suffix}): ${found.join(", ")}`);
  return found[0];
}

/**
 * The manifest object for the files in `dir`.
 * @param {{dir: string, version: string, baseUrl: string, releaseUrl: string, selfCheck?: boolean, require?: string[], pubDate?: string}} options
 */
export function buildManifest({ dir, version, baseUrl, releaseUrl, selfCheck = false, require = Object.keys(KINDS), pubDate = new Date().toISOString() }) {
  const next = selfCheckVersion(version); // also checks that `version` is major.minor.patch
  const manifestVersion = selfCheck ? next : version;
  for (const [name, url] of [["--base-url", baseUrl], ["--release-url", releaseUrl]]) {
    if (!URL.canParse(url)) throw new Error(`${name} is not a URL: "${url}"`);
  }
  const names = readdirSync(dir);
  const platforms = {};
  const missing = [];
  for (const kind of Object.keys(KINDS)) {
    const file = findBySuffix(names, kind);
    if (file === undefined) {
      if (require.includes(kind)) missing.push(`${kind} update file (*${KINDS[kind].suffix})`);
      continue;
    }
    const signatureFile = file + (selfCheck ? SELF_CHECK_SIGNATURE_SUFFIX : SIGNATURE_SUFFIX);
    if (!names.includes(signatureFile)) {
      missing.push(`signature ${signatureFile}${selfCheck ? ` (made by: ${signCommand(manifestVersion, file)})` : ""}`);
      continue;
    }
    const signature = readFileSync(join(dir, signatureFile), "utf8").trim();
    if (signature === "") {
      missing.push(`signature ${signatureFile} (empty)`);
      continue;
    }
    const entry = { url: assetUrl(baseUrl, file), signature };
    for (const target of KINDS[kind].targets) platforms[target] = { ...entry };
  }
  if (missing.length > 0) throw new Error(`missing in ${dir}: ${missing.join("; ")}`);
  if (Object.keys(platforms).length === 0) throw new Error(`no update file in ${dir}`);
  return { version: manifestVersion, pub_date: pubDate, notes: releaseUrl, platforms };
}

const VALUE_OPTIONS = ["dir", "version", "base-url", "release-url", "require", "pub-date", "out"];

/** The options of a command line (`--name value`, and the flag `--self-check`). */
export function parseArgs(argv) {
  const options = { selfCheck: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--self-check") {
      options.selfCheck = true;
    } else if (arg.startsWith("--") && VALUE_OPTIONS.includes(arg.slice(2))) {
      const value = argv[++i];
      if (value === undefined) throw new Error(`${arg} needs a value`);
      options[arg.slice(2).replace(/-(\w)/g, (_, c) => c.toUpperCase())] = value;
    } else {
      throw new Error(`unknown argument "${arg}"`);
    }
  }
  for (const required of ["dir", "version", "base-url", "release-url"]) {
    const key = required.replace(/-(\w)/g, (_, c) => c.toUpperCase());
    if (options[key] === undefined) throw new Error(`--${required} is required`);
  }
  if (options.require !== undefined) options.require = parseKinds(options.require);
  return options;
}

/** Runs a command line: writes the manifest (default `<dir>/latest.json` or `<dir>/self-check.json`); returns its path. */
export function run(argv) {
  const { out, ...options } = parseArgs(argv);
  const manifest = buildManifest(options);
  const path = out ?? join(options.dir, options.selfCheck ? "self-check.json" : "latest.json");
  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`);
  return path;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    console.log(`wrote ${run(process.argv.slice(2))}`);
  } catch (error) {
    console.error(`update-manifest: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
