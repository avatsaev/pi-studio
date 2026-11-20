/**
 * The outdated-daemon notice's decision (sprint-110/task-006): given the host's
 * `app.minDaemonVersion` and the version a daemon reported in `server_info`, answer "no notice"
 * or the notice's text. Pure; `use-outdated-daemon-notice.ts` decides when to ask and shows the toast.
 */

/** Matches `major.minor.patch`, optionally `v`-prefixed and/or followed by a `-pre`/`+build` suffix. */
const SEMVER = /^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/;

/** How a user brings an old daemon up to date. */
export const DAEMON_UPDATE_HINT =
  "Update it with `npm i -g @av-pi-studio/cli`, then restart the daemon.";

/** `[major, minor, patch]`, or `null` for anything that is not a semantic version. A pre-release or
 *  build suffix is ignored: `0.0.119-beta.1` counts as `0.0.119`. */
export function parseVersion(version: string): [number, number, number] | null {
  const match = SEMVER.exec(version.trim());
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/** `a` ordered against `b` part by part, numerically (`0.0.9` is below `0.0.119`). */
function compareVersions(a: [number, number, number], b: [number, number, number]): number {
  for (let i = 0; i < 3; i++) {
    const diff = a[i]! - b[i]!;
    if (diff !== 0) return diff;
  }
  return 0;
}

/**
 * The notice for a daemon that reported `reported` (absent when the daemon sent none), or `null`
 * when none is due: no usable minimum, or the daemon meets it. An unparsable `reported` counts as
 * absent; an unparsable minimum cannot be compared against, so it counts as no minimum.
 */
export function outdatedDaemonNotice(
  minVersion: string | undefined,
  reported: string | undefined,
): string | null {
  if (minVersion === undefined) return null;
  const min = parseVersion(minVersion);
  if (!min) return null;
  const actual = reported === undefined ? null : parseVersion(reported);
  const expects = `this app expects ${minVersion.trim()} or newer.`;
  if (!actual) {
    return `This daemon did not report a version; ${expects} ${DAEMON_UPDATE_HINT}`;
  }
  if (compareVersions(actual, min) >= 0) return null;
  return `This daemon is ${(reported ?? "").trim()}; ${expects} ${DAEMON_UPDATE_HINT}`;
}
