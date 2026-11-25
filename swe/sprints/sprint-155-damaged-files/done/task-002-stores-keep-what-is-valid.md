# Task 002 — Stores keep what is valid: registries, agent records, viewer settings, the skip file

- **Sprint:** sprints/sprint-155-damaged-files
- **Status:** done
- **Type:** bugfix
- **Area:** packages/server (persistence, projects, viewers, update)
- **Priority:** P1
- **Estimated size:** M
- **Depends on:** task-001

## Goal
One bad record costs one record, not a whole registry, and no store is rewritten over data it could
not read.

## Context / why
`projects.json` and `workspaces.json` are validated as whole arrays, so one bad record empties the
registry and the next write makes that permanent. The workspace registry reads, awaits and writes with
no lock: two `open_project_request` calls at once can lose a record. A bad agent record is skipped
without a word, and a dangling symlink in `agents/` makes the whole recovery fail. A damaged
`viewer-settings.json` is overwritten by the next change. `update-skip.json` is written in place.

## Scope references
- `docs/daemon-audit-handoff.md` § "M5 choices" (damaged files), § F2, § 7 (viewer settings)
- `packages/server/src/persistence/entity-stores.ts` (`loadAllAgents` :86-103, `loadEntityOrNull`,
  the project and workspace stores), `entity-stores.test.ts`
- `packages/server/src/projects/workspace-registry.ts` (:77-165), `workspace-registry.test.ts`
- `packages/server/src/viewers/viewer-settings-state.ts` (:74), `update/update-service.ts`
  (`createFileSkipStore` near :671)

## What to build
- **Registries.** A file with some invalid records: the original is set aside, the valid records are
  kept and written back, and the number dropped is logged. A file that does not parse: set aside, then
  empty.
- **Workspace registry.** Each read-modify-write runs under one lock per registry.
- **Agent records.** A bad record is set aside and logged; the others load. An unreadable entry or a
  dangling symlink in `agents/` is logged and skipped.
- **Viewer settings.** A damaged file is set aside, then all viewers are enabled as today.
- **Skip file.** Written through `atomicWriteJson`.
- `extensions-state.json` keeps its "unreadable" rule (it is never rewritten) and
  `pending-uploads.json` keeps its journal rule: no change.

## Out of scope
`config.json` and the identity files (tasks 003 and 004).

## Acceptance criteria
- [ ] Three workspaces, one invalid: two are kept, and the set-aside file holds the original bytes.
- [ ] Two concurrent `open_project_request` calls for different folders: both are recorded.
- [ ] A bad agent record is set aside and the daemon recovers the others; a dangling symlink does not
      stop recovery.
- [ ] A damaged viewer settings file is set aside before the next change is written.
- [ ] A crash during the skip file's write leaves the previous file.

## Test / verification plan
- `npx vitest run packages/server/src/persistence packages/server/src/projects packages/server/src/viewers packages/server/src/update`
- `npm run build:server`
