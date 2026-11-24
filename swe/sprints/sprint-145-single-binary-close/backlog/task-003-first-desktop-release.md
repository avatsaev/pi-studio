# Task 003 — After the owner's merge: the first desktop release with a pinned daemon

- **Sprint:** sprints/sprint-145-single-binary-close
- **Status:** backlog
- **Type:** chore
- **Area:** release
- **Priority:** P2
- **Estimated size:** XS
- **Depends on:** task-002

## Goal
The owner merges the desktop part (sprints 143–145); the desktop release pins the newest published
binary, passes its update check and is promoted.

## Context / why
Merging is the owner's call; this task asks and waits. Pipelines are looked at only when the owner
asks (owner's rule).

## Scope references
- `swe/features/single-binary-daemon.md` § The pin, S6

## What to build
Ask the owner to merge; when asked to look: the run's pin step wrote the version of `latest.json`;
`desktop-updates/latest.json` names the new app version.

## Acceptance criteria
- [ ] Recorded; a failure fixed in a follow-up pull request the owner merges.

## Test / verification plan
- `gh run view`; `gh release view desktop-v<version>`

## Notes
The first real macOS run of the app's download is the owner's own update (D16).
