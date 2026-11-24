# Task 004 — A binary daemon checks, installs, restarts and rolls back

- **Sprint:** sprints/sprint-142-binary-self-update
- **Status:** backlog
- **Type:** feature
- **Area:** packages/server (update), packages/cli
- **Priority:** P1
- **Estimated size:** M
- **Depends on:** task-001, task-002, sprint-140/task-001

## Goal
With install kind `binary`, the update service reads `daemon-updates/latest.json`, installs the
system's asset into `bin/versions/<v>`, and the `__update-helper` sub-command switches `current`,
starts the new daemon and rolls back; `pi-studio update` does the same from the CLI.

## Context / why
D7, D13, P15, A8.

## Scope references
- `swe/features/self-update.md` § Install kind, § Check, § Apply (Binary), § The helper (Binary helper), § CLI
- `swe/features/single-binary-daemon.md` § Public contract 1 and 3
- `packages/server/src/update/` (`install-kind.ts`, `update-service.ts`, `helper.ts`), `packages/cli/src/update-control.ts`, `packages/cli/src/binary-main.ts`, `packages/server/src/runtime/self.ts`

## What to build
- Can-update rule: `realpath(execPath)` is `$PI_STUDIO_HOME/bin/versions/<v>/pi-studio` and `bin` is
  writable; else `cannot_update(unmanaged_binary | not_writable)` (command: the release page).
- Check: GET the manifest (15 s), version and the asset for this system.
- Apply: download to `bin/tmp` (60 s stall), SHA-256, unpack (refuse entries outside the folder),
  `--version` check, move to `versions/<v>`; the new binary's `__pi update --extensions`; restart via
  `helperCommand` from the new binary.
- `__update-helper`: wait for the old PID; switch `current` (symlink + rename); three tries of start +
  health; on failure switch back and start the previous; write `update-result.json`; after `updated`
  remove version folders other than target and previous. Log to `logs/update-restart.log`.
- `pi-studio update` / `update --check` on a binary.
- A test-only override of the manifest URL, `PI_STUDIO_DAEMON_UPDATE_URL` (documented as for tests and
  self-hosting; never set in releases).

## Out of scope
The desktop app's own install of the pin (sprint-143).

## Acceptance criteria
- [ ] Unit tests: the can-update rule; check with a local server (newer, same, malformed, missing
      asset); apply failures (checksum, path outside, bad `--version`) leave `current` untouched; the
      helper's link switch and switch-back.
- [ ] Node suite green.

## Test / verification plan
- `npx vitest run packages/server/src/update packages/cli`; the live run is task-005.

## Notes
The npm path must not change; the existing npm tests are the guard.
