// The pure version rules of `scripts/set-version.mjs` (tested by `version-test.mjs`).
//
// The npm packages carry one lockstep version. The version committed in packages/*/package.json is
// only a floor: a release (`release.yml`) takes the patch after the highest version npm has,
// unless the committed one is higher, which is then released as is (that is how a minor or major
// release is made: raise the floor with `npm run version:set -- minor`). Nothing is committed back,
// like the desktop app's `desktop-v*` releases (`desktop/apps/pistudiodesktop/scripts/release/next-version.mjs`).

export const PLAIN_VERSION = /^(\d+)\.(\d+)\.(\d+)$/;

/** `[major, minor, patch]` of a plain `MAJOR.MINOR.PATCH` version; throws on anything else. */
export function parse(version) {
  const match = PLAIN_VERSION.exec(version);
  if (!match) throw new Error(`'${version}' is not MAJOR.MINOR.PATCH`);
  return match.slice(1).map(Number);
}

/** Negative, zero or positive as `a` is below, equal to or above `b`. */
export function compare(a, b) {
  const [x, y] = [parse(a), parse(b)];
  for (let i = 0; i < 3; i += 1) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
}

/** The highest plain version among `versions` (pre-releases and anything else are ignored), or `undefined`. */
export function highest(versions) {
  return versions.filter((v) => PLAIN_VERSION.test(v)).toSorted((a, b) => compare(b, a))[0];
}

/** `current` with one component raised: `patch`, `minor` or `major`. */
export function bump(current, kind) {
  const [major, minor, patch] = parse(current);
  if (kind === "patch") return `${major}.${minor}.${patch + 1}`;
  if (kind === "minor") return `${major}.${minor + 1}.0`;
  if (kind === "major") return `${major + 1}.0.0`;
  throw new Error(`'${kind}' is not patch, minor or major`);
}

/**
 * The version of the next release: the patch after the highest published version, unless the
 * committed `floor` is higher (used as is). `published` is every version of every published
 * package, so a release that stopped half way (some packages published, `cli` not) is skipped over
 * rather than finished with a different commit's code.
 */
export function nextRelease({ floor, published }) {
  parse(floor);
  const top = highest(published);
  if (top === undefined || compare(floor, top) > 0) return floor;
  return bump(top, "patch");
}

/** The version `set-version.mjs <arg>` writes: `patch`/`minor`/`major` of `current`, or an explicit higher version. */
export function resolveTarget(arg, current) {
  if (arg === "patch" || arg === "minor" || arg === "major") return bump(current, arg);
  if (compare(arg, current) <= 0)
    throw new Error(`${arg} is not higher than the current version ${current}`);
  return arg;
}
