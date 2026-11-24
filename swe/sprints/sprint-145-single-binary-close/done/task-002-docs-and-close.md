# Task 002 — Documents and spec close for milestone 6

- **Sprint:** sprints/sprint-145-single-binary-close
- **Status:** done
- **Type:** docs
- **Area:** docs
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** task-001

## Goal
Every document that names the CLI search, the npm instructions or the release pipeline says what the
code does now; the specs are closed from the evidence.

## Scope references
- Root `AGENTS.md` (monorepo layout's desktop paragraph, release section: the binaries jobs and
  `daemon-v*`/`daemon-updates`, persistence layout `bin/` and `update-skip.json`, env
  `PI_STUDIO_DAEMON_UPDATE_URL`, Pi dependency posture: the fifth mirrored place, Tech stack: Bun),
  root `README.md`
- `packages/server/AGENTS.md`, `packages/cli/AGENTS.md`/`README.md`, `packages/protocol/AGENTS.md`,
  `packages/workbench/AGENTS.md`
- `desktop/AGENTS.md`, `desktop/docs/architecture.md` (the `install` crate, the local daemon row of
  the decisions table), `desktop/docs/development.md` (building and checking with binaries)
- `fern/` install and desktop pages
- `swe/features/single-binary-daemon.md`, `desktop-ssh-daemon-install.md`, `self-update.md`,
  `swe/architecture/single-binary-daemon.md`, `swe/MAIN-SCOPE.md`: status, ticked criteria with
  evidence, "Resolved by the build", TODO(verify)

## Acceptance criteria
- [x] No document tells a desktop user to install the CLI with npm for the app's sake; no document
      claims something not seen.

## Test / verification plan
- `grep -rn "cliPath\|cli_missing\|npm i -g @av-pi-studio/cli" desktop packages/workbench fern AGENTS.md README.md` shows only intended mentions.

## Notes
Docs are deliverables; match each file's voice.
