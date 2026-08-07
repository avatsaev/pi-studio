# Task 004 — Entity store schemas + accessors

- **Sprint:** sprint-003-persistence-config
- **Status:** done
- **Estimated size:** M
- **Depends on:** task-001

## Goal
Define the Zod schemas and file-backed accessors for every persisted daemon entity, using the atomic
store primitive (loop store via the queued non-atomic writer).

## Scope references
- `clean-room-scope/architecture/persistence.md` § Data shapes (field tables)
- `clean-room-scope/MAIN-SCOPE.md` § 5 (Key files on disk)

## What to build
- Schemas + load/save accessors for:
  - **Agent record** → `agents/{sanitized-cwd}/{id}.json` (one file per agent; record + timeline rows).
    Include `sanitizeCwd(cwd)` (strip root, separators → `-`, Windows drive `C-` prefix).
    `AgentFeature` discriminated union (toggle/select).
  - **Schedule** → `schedules/{id}.json` (id = 8 hex); `cadence`, `target`, `runs: ScheduleRun[]`.
  - **Loop** → `loops/loops.json` (array; queued non-atomic).
  - **Chat** → `chat/rooms.json` (`{ rooms, messages }`).
  - **Project registry** → `projects/projects.json`; **Workspace registry** → `projects/workspaces.json`.
- Each accessor round-trips through Zod and tolerates unknown/optional fields.

## Out of scope
- Business logic over these stores (agent manager, schedule/loop/chat services) — later sprints.
- Timeline sequencing/paging logic (sprint-006).

## Acceptance criteria
- [ ] An agent persists to `agents/{sanitized-cwd}/{id}.json` and round-trips through Zod.
- [ ] `sanitizeCwd` maps a path to a stable directory-safe key.
- [ ] Unknown/optional fields are tolerated on load (no migration needed).
- [ ] Loop store uses the queued non-atomic writer.
- [ ] Project/workspace registries load arrays with `archivedAt` soft-delete fields.

## Test / verification plan
- Tests: `npx vitest run .../entity-stores.test.ts` — per-entity round-trip + sanitizeCwd + tolerance.

## Notes
- Recovery rule (running loops → stopped) is applied by services at boot, not here.
