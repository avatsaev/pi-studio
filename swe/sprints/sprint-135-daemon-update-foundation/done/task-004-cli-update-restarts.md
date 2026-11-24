# Task 004 — `pi-studio update` restarts a running local daemon

- **Sprint:** sprints/sprint-135-daemon-update-foundation
- **Status:** done
- **Type:** feature
- **Area:** packages/cli (update-commands)
- **Priority:** P1
- **Estimated size:** XS
- **Depends on:** task-002, task-003

## Goal
After a successful install `pi-studio update` restarts the local daemon when one is running and reports the version that answers.

## Context / why
Spec § CLI (P13); the desktop's Update (sprint-138) relies on it.

## Scope references
- `swe/features/self-update.md` § CLI
- `packages/cli/src/update-commands.ts` (+ test), `packages/cli/src/daemon-control.ts`

## What to build
- After install and the extensions step: when a local daemon answers health, stop it (waiting for the exit), start it with the same listen address it had, and print `daemon restarted: <version>`; when none runs, nothing more.
- A failed restart exits non-zero with the reason; the install is not undone.
- `update --check` unchanged.

## Out of scope
The daemon's own apply (sprint-136).

## Acceptance criteria
- [ ] Tests with the injected runtimes: daemon running → restarted on the same host and port; not running → not started; install failed → no restart.
- [ ] The health version after the restart is printed.

## Test / verification plan
- `npx vitest run packages/cli/src`
- `npm run build:cli && npm run typecheck && npm run lint`

## Notes
Docs: `packages/cli/README.md` and `AGENTS.md` (`update`), `fern/` CLI page if it describes `update`.
