# Task 003 — The desktop release pins the newest daemon binary

- **Sprint:** sprints/sprint-141-binary-release
- **Status:** backlog
- **Type:** feature
- **Area:** desktop/apps/pistudiodesktop/scripts/release, .github/workflows/desktop-release.yml
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** task-001

## Goal
`daemon-pin.mjs` reads `daemon-updates/latest.json`, waits for a version at or above the app's
minimum, and writes `desktop/daemon-pin.json`; the desktop release runs it before building.

## Context / why
P2, P14, S5, S6.

## Scope references
- `swe/features/single-binary-daemon.md` § The pin
- Create: `desktop/apps/pistudiodesktop/scripts/release/daemon-pin.mjs`, `daemon-pin-test.mjs`
- `.github/workflows/desktop-release.yml` (a step in the `version` job or before the bundle jobs;
  the bundle jobs build with the written file)
- `desktop/crates/shell/src/daemons.rs` (`min_daemon_version`, read by the script from the source or
  passed in)

## What to build
`node daemon-pin.mjs --manifest <url> --min <version> --out <file> [--wait-minutes 30]`: fetch, retry
every 60 s while the version is below the minimum, fail after the wait with
`no daemon binary ≥ <min> is published`; write `{version, assets}` for the four targets. A developer
runs it without `--wait-minutes` to refresh the committed file.

## Out of scope
Compiling the pin into the app (sprint-143/task-001). The committed `desktop/daemon-pin.json` is
written there, from the first published binaries.

## Acceptance criteria
- [ ] Tests with a local server: a good manifest writes the file; a manifest below the minimum waits
      then fails; a malformed one fails.
- [ ] `actionlint` clean.

## Test / verification plan
- `cd desktop/apps/pistudiodesktop && node --test 'scripts/release/*-test.mjs'`; `actionlint`

## Notes
Until a binary is published, a desktop release with this step would wait and fail: the step is
enabled by sprint-143/task-001, which commits the first pin (keep it guarded until then, e.g. it runs
only when `desktop/daemon-pin.json` exists).
