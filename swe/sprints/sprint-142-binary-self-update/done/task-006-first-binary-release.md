# Task 006 — After the owner's merge: the first published binaries

- **Sprint:** sprints/sprint-142-binary-self-update
- **Status:** done
- **Type:** chore
- **Area:** release
- **Priority:** P1
- **Estimated size:** XS
- **Depends on:** task-003, task-005, sprint-141/task-004

## Goal
The owner merges the first part of milestone 6 (sprints 139–142); the release run publishes
`daemon-v<version>` and `daemon-updates/latest.json`, and that is checked.

## Context / why
The desktop part (sprint 143 onwards) pins a published binary. Merging is the owner's call: this task
asks, and waits.

## Scope references
- `swe/features/single-binary-daemon.md` § Acceptance criteria (release rows)

## What to build
Mark the pull request ready and ask the owner to merge. After the run (only when the owner asks to
look, or at the start of sprint 143): the release exists, is not "latest", has four archives and
`SHA256SUMS`; `latest.json` names the version; one archive downloaded and checked against it. A
macOS-built binary started in the run's smoke test (D16).

## Acceptance criteria
- [ ] Each item above recorded; any failure fixed in a follow-up pull request the owner merges.

## Test / verification plan
- `gh release view daemon-v<version> --json assets`; `curl -L …/daemon-updates/latest.json`

## Notes
The merge also publishes npm and Docker as every merge does.
