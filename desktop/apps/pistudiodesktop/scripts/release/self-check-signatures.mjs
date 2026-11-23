// Signs each update file of a release a second time, for the self check (spec U6), and keeps the
// result as `<file>.selfcheck.sig`:
//
//   node self-check-signatures.mjs --dir <files> --version <N>
//
// `update-manifest.mjs --self-check` offers N its own files under the version `<N's next patch>-selfcheck`,
// and the plug-in refuses a file whose signature does not say that version in its trusted comment. The
// signature the bundler made (`<file>.sig`) says N, and signing the real file again would overwrite it, so
// each update file is signed as a copy in a scratch directory, and only the copy's signature is moved
// next to the real file. The copy has the name GitHub gives the uploaded file (spaces become dots), so
// the signature's own `file:` comment names the asset, and so the signer's command line needs no quoting.
//
// The key is the signer's own: `TAURI_SIGNING_PRIVATE_KEY` (the key's text) and
// `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` (empty) in the environment. It is never read or printed here.

import { spawnSync } from "node:child_process";
import { copyFileSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { assetName, findBySuffix, KINDS, selfCheckVersion } from "./update-manifest.mjs";

const SELF_CHECK_SIGNATURE_SUFFIX = ".selfcheck.sig";

/** The tauri CLI's signer, run with this node: `npx` is a `.cmd` on Windows and needs a shell. Throws with the signer's output on failure. */
export function tauriSign(version, file) {
  const cli = createRequire(import.meta.url).resolve("@tauri-apps/cli/tauri.js");
  const result = spawnSync(process.execPath, [cli, "signer", "sign", "--app-version", version, file], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`tauri signer sign failed for ${file} (${result.error?.message ?? `exit ${result.status}`}):\n${result.stdout}${result.stderr}`);
}

/**
 * Makes `<file>.selfcheck.sig` for every update file in `dir`; returns the names of the files it made.
 * `sign(version, file)` signs `file` for `version` and leaves `<file>.sig` beside it.
 * @param {{dir: string, version: string, sign?: (version: string, file: string) => void}} options
 */
export function selfCheckSignatures({ dir, version, sign = tauriSign }) {
  const selfCheck = selfCheckVersion(version);
  const names = readdirSync(dir);
  const scratch = mkdtempSync(join(tmpdir(), "self-check-sign-"));
  const made = [];
  try {
    for (const kind of Object.keys(KINDS)) {
      const file = findBySuffix(names, kind);
      if (file === undefined) continue;
      const copy = join(scratch, assetName(file));
      copyFileSync(join(dir, file), copy);
      sign(selfCheck, copy);
      // Copied, not renamed: the scratch directory may be on another drive (Windows' temp is on C:, the runner's work on D:).
      copyFileSync(`${copy}.sig`, join(dir, `${file}${SELF_CHECK_SIGNATURE_SUFFIX}`));
      made.push(`${file}${SELF_CHECK_SIGNATURE_SUFFIX}`);
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
  if (made.length === 0) throw new Error(`no update file in ${dir}`);
  return made;
}

/** The options of a command line: `--dir` and `--version`, both required. */
export function parseArgs(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i += 2) {
    const name = argv[i];
    if (name !== "--dir" && name !== "--version") throw new Error(`unknown argument "${name}"`);
    const value = argv[i + 1];
    if (value === undefined) throw new Error(`${name} needs a value`);
    options[name.slice(2)] = value;
  }
  for (const required of ["dir", "version"]) if (options[required] === undefined) throw new Error(`--${required} is required`);
  return options;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const made = selfCheckSignatures(parseArgs(process.argv.slice(2)));
    console.log(`wrote ${made.length} self-check signatures: ${made.join(", ")}`);
  } catch (error) {
    console.error(`self-check-signatures: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
