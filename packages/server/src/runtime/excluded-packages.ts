/**
 * Pi package sources a daemon running as the single binary neither installs nor loads
 * (`swe/features/single-binary-daemon.md` § Pi in the binary, D2).
 *
 * `@99percentpeople/pi-background-tasks` imports `node-pty`, which does not load under Bun; Pi then
 * exits and no agent starts. Pi's own standalone binary fails the same way.
 */
export const BINARY_EXCLUDED_PACKAGES: readonly string[] = [
  "npm:@99percentpeople/pi-background-tasks",
];
