// Turns a directory of the daemon's four release archives into `SHA256SUMS` and `latest.json`.
//
//   node daemon-manifest.mjs --version <N> --dir <archives> --base-url <asset URL prefix> [--pub-date <ISO 8601>]
//
// The directory must hold exactly one `pi-studio-<N>-<target>.tar.gz` per target and no other
// `pi-studio-*.tar.gz` (spec `swe/features/single-binary-daemon.md` § Public contract 1): one missing
// binary publishes none, and `latest.json` then keeps the previous version. Writes, into the directory:
//
//   SHA256SUMS   `<sha256>  <name>` lines (the format of `sha256sum -c`), in target order
//   latest.json  { version, pub_date, assets: { <target>: { url, sha256, size } } }
//
// The asset URL is `<base-url>/<archive name>`: the names have no space or other character GitHub
// rewrites, so the name is used as it is.

import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

/** The release targets, in manifest order (the keys of `scripts/build-binary.mjs`'s `TARGETS`). */
export const TARGETS = ["linux-x64", "linux-arm64", "darwin-arm64", "darwin-x64"];

const PLAIN_VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const ARCHIVE = /^pi-studio-.*\.tar\.gz$/;

/** The archive name of `target` at `version`. */
export const archiveName = (version, target) => `pi-studio-${version}-${target}.tar.gz`;

/**
 * The manifest, the checksum lines and the archive names for the archives in `dir`.
 * @param {{dir: string, version: string, baseUrl: string, pubDate?: string}} options
 */
export function buildFiles({ dir, version, baseUrl, pubDate = new Date().toISOString() }) {
  if (!PLAIN_VERSION.test(version))
    throw new Error(`version "${version}" is not <major>.<minor>.<patch>`);
  const present = readdirSync(dir).filter((name) => ARCHIVE.test(name));
  const expected = new Map(TARGETS.map((target) => [archiveName(version, target), target]));
  const unexpected = present.filter((name) => !expected.has(name));
  if (unexpected.length > 0) {
    throw new Error(
      `unexpected archive${unexpected.length > 1 ? "s" : ""} in ${dir} (version ${version}): ${unexpected.toSorted().join(", ")}`,
    );
  }
  const missing = TARGETS.filter((target) => !present.includes(archiveName(version, target)));
  if (missing.length > 0) {
    throw new Error(
      `missing target${missing.length > 1 ? "s" : ""} ${missing.join(", ")}: no ${missing.map((target) => archiveName(version, target)).join(", ")} in ${dir}`,
    );
  }

  const prefix = baseUrl.replace(/\/+$/, "");
  const assets = {};
  const sums = [];
  for (const target of TARGETS) {
    const name = archiveName(version, target);
    const bytes = readFileSync(join(dir, name));
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    assets[target] = { url: `${prefix}/${name}`, sha256, size: bytes.length };
    sums.push(`${sha256}  ${name}`);
  }
  return { manifest: { version, pub_date: pubDate, assets }, sums: `${sums.join("\n")}\n` };
}

const VALUE_OPTIONS = ["dir", "version", "base-url", "pub-date"];

/** The options of a command line (`--name value`). */
export function parseArgs(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--") || !VALUE_OPTIONS.includes(arg.slice(2)))
      throw new Error(`unknown argument "${arg}"`);
    const value = argv[++i];
    if (value === undefined) throw new Error(`${arg} needs a value`);
    options[arg.slice(2).replace(/-(\w)/g, (_, c) => c.toUpperCase())] = value;
  }
  for (const required of ["dir", "version", "base-url"]) {
    const key = required.replace(/-(\w)/g, (_, c) => c.toUpperCase());
    if (options[key] === undefined) throw new Error(`--${required} is required`);
  }
  return options;
}

/** Runs a command line: writes `SHA256SUMS` and `latest.json` into the directory; returns their paths. */
export function run(argv) {
  const options = parseArgs(argv);
  const { manifest, sums } = buildFiles(options);
  const sumsPath = join(options.dir, "SHA256SUMS");
  const manifestPath = join(options.dir, "latest.json");
  writeFileSync(sumsPath, sums);
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return [sumsPath, manifestPath];
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    console.log(`wrote ${run(process.argv.slice(2)).join(", ")}`);
  } catch (error) {
    console.error(`daemon-manifest: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
