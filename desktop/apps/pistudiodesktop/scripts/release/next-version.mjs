// The version of the next desktop release (`desktop-release.yml`, job `version`):
//
//   git tag -l | node next-version.mjs --floor <[workspace.package] version of desktop/Cargo.toml>
//
// Prints `<highest released version or "none"> <next version>`. The next version is the patch after
// the highest `desktop-v<major.minor.patch>` tag, unless the floor is higher, which is then used as is
// (a minor or major release is made by raising it). Every other tag is ignored: other products' tags,
// pre-release suffixes, and `desktop-updates`, the tag of the release that holds the offered manifest.

import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const PLAIN_VERSION = /^(\d+)\.(\d+)\.(\d+)$/;
const RELEASE_TAG = /^desktop-v(\d+\.\d+\.\d+)$/;

const parts = (version) => PLAIN_VERSION.exec(version).slice(1).map(Number);

/** Negative, zero or positive as `a` is below, equal to or above `b` (both major.minor.patch). */
export function compareVersions(a, b) {
  const [x, y] = [parts(a), parts(b)];
  for (let i = 0; i < 3; i += 1) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
}

/** The versions of the `desktop-v<major.minor.patch>` tags among `tags`, highest first. */
export function releasedVersions(tags) {
  return tags
    .map((tag) => RELEASE_TAG.exec(tag.trim())?.[1])
    .filter((version) => version !== undefined)
    .sort((a, b) => compareVersions(b, a));
}

/**
 * The version of the next release, and the highest one released (`undefined` when none is).
 * @param {{floor: string, tags: string[]}} input
 */
export function nextVersion({ floor, tags }) {
  if (!PLAIN_VERSION.test(floor)) throw new Error(`version '${floor}' is not MAJOR.MINOR.PATCH (desktop/Cargo.toml says '${floor}')`);
  const [latest] = releasedVersions(tags);
  if (latest === undefined || compareVersions(floor, latest) > 0) return { latest, version: floor };
  const [major, minor, patch] = parts(latest);
  return { latest, version: `${major}.${minor}.${patch + 1}` };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv[2] !== "--floor" || process.argv[3] === undefined) throw new Error("usage: git tag -l | node next-version.mjs --floor <version>");
    const { latest, version } = nextVersion({ floor: process.argv[3], tags: readFileSync(0, "utf8").split("\n") });
    console.log(`${latest ?? "none"} ${version}`);
  } catch (error) {
    console.error(`::error::${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
