# Task 006 — Drop four uncalled pieces of code and the dead config keys — Summary

- **Sprint:** sprints/sprint-147-drop-dead-subsystems
- **Completed:** 2026-11-25
- **Status:** done

## What was implemented
Deleted `agent/provider-snapshot.ts` and `snapshot.test.ts`, `projects/reconciliation.ts` (+test), `projects/workspace-activity.ts` (+ its tests in `open-project.test.ts`), `PiAgentSession.history`/`streamHistory` and `streamHistory` in the provider contract, `PiClientDeps.appendSystemPrompt` (no live caller), and the config keys `log.*`, `worktrees.root`, `daemon.appendSystemPrompt`, `providers.local.modelsDir`. The mock provider keeps its private event list. A config that still has the removed keys loads (new test).

## Build & test results
```
$ npx vitest run packages/server/src   -> 111 files, 1580 passed
$ npm run build:server                 -> success
Sprint end gate (full tree, after tasks 001-006):
$ npm run build -> 0; npm run typecheck -> 0; npm run lint -> 0 (existing warnings only)
$ npm test -> 323 files, 4657 tests, all passed; oxfmt --check on changed source files clean
$ cd desktop && cargo xtask ci -> all 8 steps passed
```
Live smoke on a temporary home and port 47381: `/api/health` 200 `{"status":"ok","version":"0.0.132"}`; any other path 404; an `OPTIONS` with an `Origin` has no `Access-Control-*` header; `pi-studio ls` works; a `config.json` with `agents.providers.foo` stops the daemon at start with `Error: agents.providers.foo: only "pi" is supported`; `pi-studio chat` is no longer a command (the CLI treats a bare word as a path to open).

## Acceptance criteria
- [x] No `streamHistory`, `ProviderSnapshotManager`, `reconcileRegistries`, `aggregateWorkspaceActivity` in `packages/server/src` (grep)
- [x] A `config.json` with the removed keys still loads (new test)

## Follow-ups / TODO(verify)
- The one-shot Pi spawn no longer takes a system prompt option; the per-agent `config.systemPrompt` is unchanged.
- The daemon prints a stack trace for a bad config (not a one-line message); not changed here.
