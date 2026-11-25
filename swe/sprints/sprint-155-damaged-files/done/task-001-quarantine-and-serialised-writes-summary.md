# Task 001 — Set a damaged file aside, and write one path at a time — Summary

- **Sprint:** sprints/sprint-155-damaged-files
- **Completed:** 2026-11-25
- **Status:** done

## What was implemented
`quarantineFile(path, reason, logger)` renames a damaged file to `<name>.corrupt-<UTC timestamp>` (adding `-1`, `-2` if taken), logs one error with `{path, quarantinedTo, reason}` and returns the new path. `loadStore(path, schema, defaults, logger)` is silent for a missing file; a file that is not JSON or fails its schema is set aside first, then the defaults are returned. A file that cannot be read (EACCES, a directory) or a rename that fails **throws** instead of returning defaults (a default would let the next save overwrite it; this ends "`loadStore` never throws"; task-002's per-entry skip in `loadAllAgents` must catch it). `atomicWriteJson` chains writes per resolved path in call order (a failed write rejects only its own caller; its temp file is removed). Loaders (`loadAgent`, `loadAllAgents`, `loadProjects`, `loadWorkspaces`) and `WorkspaceRegistryService(home, logger)` take a required logger; `OpenProjectService` and `WorktreeService` now take the registry (required) instead of creating one, which task-002's lock needs; `AgentManagerDeps.loadAllAgents` is required (its disk default was never used).

## Files changed
`persistence/{atomic-store,entity-stores}.ts`, `projects/{workspace-registry,open-project,worktree-service}.ts`, `agent/agent-manager.ts`, `daemon/bootstrap.ts` (logger pass-throughs and the registry), tests (`atomic-store.test.ts` rewritten, 13 tests; entity-stores, workspace-registry, open-project, worktree-service, bootstrap, shutdown), `packages/server/AGENTS.md`.

## Build & test results
```
npx vitest run persistence, projects, agent-manager, bootstrap, shutdown -> 11 files, 144 passed; build:server OK; oxlint/oxfmt clean
Full-tree gate: build, typecheck 0 errors; lint 0 errors; npm test (two runs) 346 files, 4991 tests passed
```

## Acceptance criteria
- [x] Bad JSON: renamed with the original bytes, defaults returned, one error logged
- [x] A schema failure: the same
- [x] Two damaged files in the same second get different names (faked clock)
- [x] 50 concurrent writes to one path: the last value wins, completion order 0..49, no temp file left
- [x] A missing file logs nothing

## Follow-ups / TODO(verify)
- `safeParseOrDefault` in `packages/protocol/src/validation.ts` is now unused outside its own test (removal candidate).
- `swe/architecture/persistence.md` (lines 75-77 and the error-handling table) still says a corrupt file falls back to defaults: updated at the close of sprint 155.
- `lsp diagnostics` shows type errors in test files tsc skips (`worktree-service.test.ts:154`, `github.test.ts:72,119`); not in lines changed here.
