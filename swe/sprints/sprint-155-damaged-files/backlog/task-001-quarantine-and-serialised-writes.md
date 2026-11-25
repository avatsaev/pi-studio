# Task 001 — Set a damaged file aside, and write one path at a time

- **Sprint:** sprints/sprint-155-damaged-files
- **Status:** backlog
- **Type:** bugfix
- **Area:** packages/server (persistence)
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** none

## Goal
A store never loses a damaged file silently, and two saves to one file cannot land out of order.

## Context / why
Finding F2 as re-read on 2026-11-25. `atomicWriteJson` is now a real temp file, fsync and rename, but
`loadStore` returns defaults for bad JSON or a schema failure with no log, and the next save then
overwrites the file. Writes to one path are not serialised.

## Scope references
- `docs/daemon-audit-handoff.md` § "M5 choices" (damaged files), § F2
- `packages/server/src/persistence/atomic-store.ts` (`atomicWriteJson` :28-58, `loadStore` :70-90),
  `atomic-store.test.ts`
- `packages/protocol/src/validation.ts` (`safeParseOrDefault` :70)

## What to build
- `quarantineFile(path, reason, logger)`: renames the file to `<name>.corrupt-<UTC timestamp>` (a name
  that never collides with an earlier one), logs an error with the path and the reason, and returns
  the new path.
- `loadStore`: a missing file gives the defaults silently; a file that does not parse or fails its
  schema is set aside first, then gives the defaults. Callers pass their logger (run lsp references,
  then `tsc -b --force`).
- `atomicWriteJson` runs one write per path at a time, in call order.

## Out of scope
The stores built on top (task-002). `config.json` (task-003).

## Acceptance criteria
- [ ] Bad JSON: the file is renamed with its original bytes, defaults are returned, one error is logged.
- [ ] A schema failure: the same.
- [ ] Two damaged files in the same second get two different names.
- [ ] 50 concurrent writes to one path: the last value wins and no temporary file is left.
- [ ] A missing file logs nothing.

## Test / verification plan
- `npx vitest run packages/server/src/persistence`
- `npm run build:server`
