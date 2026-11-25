# Task 002 — Stores keep what is valid: registries, agent records, viewer settings, the skip file — Summary

- **Sprint:** sprints/sprint-155-damaged-files
- **Completed:** 2026-11-25
- **Status:** done

## What was implemented
A registry file with some invalid records is set aside (`.corrupt-<timestamp>`) and the valid records are written back (`N of M records invalid` plus the first three reasons are logged); bad JSON or a non-array is set aside and the registry starts empty. The workspace registry holds two `createLimiter(1)` locks (projects, workspaces), every method including `list*` runs under its lock (a read that repairs the file would race a save). `loadAllAgents` catches per entry: an unreadable entry, a dangling symlink or a directory named `x.json` is logged and skipped; a bad record is set aside by `loadStore`. `loadViewerSettings` uses `loadStore` (a damaged file is set aside and all viewers load enabled; an unreadable one throws so `set` cannot overwrite it). `createFileSkipStore.write` goes through `atomicWriteJson`.

## Files changed
`persistence/entity-stores.ts`, `projects/workspace-registry.ts`, `viewers/viewer-settings-state.ts` and `viewer-settings-rpc.ts` (the logger dep is required), `update/update-service.ts` (`createFileSkipStore`), their tests; docs `packages/server/AGENTS.md`, root `AGENTS.md`, `swe/architecture/persistence.md` (the corrupt-file rules and error table).

## Build & test results
```
npx vitest run persistence, projects, viewers, update, bootstrap.test -> 22 files, 352 passed; build:server OK; oxfmt/oxlint clean
With both registry locks widened to 64, 5 of 14 registry tests fail (the lock is what the tests pin)
Full-tree gate: build, typecheck 0 errors; lint 0 errors; npm test (three runs) 349 files, 5087 tests passed
```

## Acceptance criteria
- [x] Three workspaces, one invalid: two kept, the set-aside file holds the original bytes
- [x] Two concurrent `open_project_request` calls for different folders are both recorded
- [x] A bad agent record is set aside and the others recover; a dangling symlink does not stop recovery
- [x] A damaged viewer settings file is set aside before the next change is written
- [x] The skip file is written through temp and rename (a real crash cannot be injected; a hard-link test shows the old bytes untouched)

## Follow-ups / TODO(verify)
- `createFileSkipStore.read` still deletes a malformed file with a warning (harmless; not set aside).
- A failed write-back after a registry repair propagates the error (the valid records are in the set-aside file).
