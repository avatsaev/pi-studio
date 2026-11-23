# Task 001 — The release check script: install, update, prove, per system

- **Sprint:** sprints/sprint-134-desktop-update-release
- **Status:** done
- **Type:** feature
- **Area:** desktop/apps/pistudiodesktop/scripts/platform-checks
- **Priority:** P1
- **Estimated size:** M
- **Depends on:** sprint-132/task-004

## Goal
`update-check.mjs` installs a build on the runner's system, drives it through the control channel to
update from a given manifest, and proves the result; it runs the same against test builds and a
local server.

## Context / why
Spec § Behavior (The release workflow), D8, U4, U6. Reuses `control-client.mjs`, `app-process.mjs`,
`wait.mjs`, `report.mjs`.

## Scope references
- `swe/features/desktop-self-update.md` § Behavior & algorithms (The release workflow), U4, U6
- New `scripts/platform-checks/update-check.mjs` (+ `.test.mjs` for its pure parts)

## What to build
- Modes: `--from <installer> --manifest <url>` (P → N) and `--self-check --manifest <url>` (N → N).
- Install per system: AppImage (copy, chmod; `libfuse2` expected), `.deb` (`sudo apt install`),
  macOS (mount the `.dmg`, copy the `.app` to `/Applications`), Windows NSIS (`/S`, per user).
- Launch with `--control`, a scratch `--config-dir`, `--secret-store file`, `--update-manifest`;
  run `update.check`, wait for `available`, `update.install`, wait for `restart_needed`,
  `update.restart`; reconnect to the control port; expect the version (P → N) or a new PID, no error
  and the installed file changed (self check). Time limits per step; a report in the job summary.
- `.deb` on Linux: install a polkit rule for the runner's user before, remove it after.

## Acceptance criteria
- [ ] Unit tests of the pure parts (arguments, expectations, report).
- [ ] Run locally on Linux against test builds and a local server for the AppImage and the `.deb`
  (in the container), recorded in the summary.

## Test / verification plan
- `node --test desktop/apps/pistudiodesktop/scripts/platform-checks/`

## Notes
TODO(verify): polkit without an agent on the runner; `APPIMAGE` and FUSE; `/Applications` writable on
the macOS runner (else the plug-in's admin dialog hangs: the step's time limit must catch it).
