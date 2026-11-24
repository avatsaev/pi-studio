# Task 002 — The baseline sync leaves out packages the binary cannot load

- **Sprint:** sprints/sprint-140-binary-build
- **Status:** backlog
- **Type:** feature
- **Area:** packages/server (extensions)
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** sprint-139/task-001, sprint-139/task-002

## Goal
On a binary daemon the curated-pack sync neither installs nor reports as missing the sources in
`BINARY_EXCLUDED_PACKAGES`; on Node nothing changes.

## Context / why
D2. `pi-background-tasks` stops every agent under Bun.

## Scope references
- `swe/features/single-binary-daemon.md` § Public contract 5, § Pi in the binary
- `swe/features/preinstalled-extensions.md` (header note of 2026-11-24)
- `packages/server/src/extensions/curated-packs.ts`, `sync-planner.ts`, `packages/server/src/runtime/excluded-packages.ts`, `self.ts`

## What to build
- The planner takes the excluded list (empty on Node, `BINARY_EXCLUDED_PACKAGES` when `isBinary`) and
  drops those entries from the selection before planning; `extensions-state.json` is not touched for
  them.
- `pi-studio extensions list --local` shows the same plan as the daemon (it uses the same planner).

## Out of scope
Hiding an installed excluded package from Pi (sprint-139/task-001's overrides).

## Acceptance criteria
- [ ] Planner tests: with the list, no install action for the excluded source; without it, unchanged.
- [ ] Existing sync tests pass.

## Test / verification plan
- `npx vitest run packages/server/src/extensions`

## Notes
The live proof (an agent starts with the package installed) is task-004.
