# Task 006 — Dev daemon: a scripted update for UI work

- **Sprint:** sprints/sprint-136-daemon-update-service
- **Status:** backlog
- **Type:** feature
- **Area:** packages/server (daemon/dev-bootstrap)
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** task-003

## Goal
The dev daemon answers the family from a script chosen by `PI_STUDIO_DEV_UPDATE`, without npm and without a real restart.

## Context / why
The workbench UI (sprint-137) must be checked in a browser against every state; the dev daemon is a repository checkout (`source`) and would only ever show `cannot_update`.

## Scope references
- `swe/features/self-update.md` § Public contract
- `packages/server/src/daemon/dev-bootstrap.ts`, the service's seams from task-003 (+ test)

## What to build
- `PI_STUDIO_DEV_UPDATE=available|cannot|fail|rollback` (unset: the family is registered with kind `source`, no newer version). `available`: version `9.9.9` offered; apply walks installing → updating_extensions → restarting with 1.5 s steps, then drops every socket and comes back reporting version `9.9.9` and `lastResult.updated`. `fail`: apply ends in `failed(permission)`. `rollback`: as `available` but `lastResult.rolled_back` and the old version. `cannot`: `cannot_update(not_writable, 9.9.9)`.
- No process is spawned and nothing is written outside the dev home.

## Out of scope
Production behavior.

## Acceptance criteria
- [ ] A test drives each script through the SDK and sees the states in order.

## Test / verification plan
- `npx vitest run packages/server/src/daemon`
- `npm run build:server && npm run typecheck && npm run lint`

## Notes
Docs: root `AGENTS.md` dev daemon line and `packages/server/AGENTS.md`.
