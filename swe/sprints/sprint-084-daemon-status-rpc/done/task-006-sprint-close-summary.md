# Task 006 — Sprint close: docs, spec amendments, gates — Summary

- **Sprint:** sprints/sprint-084-daemon-status-rpc
- **Completed:** 2026-11-13
- **Status:** done

## What was implemented
`packages/server/AGENTS.md`: layout entries plus an "Observability" subsystem section (service, sampler, timer lifecycle, `Session` metadata, `version.ts`, unadvertised until `daemonObservability`). `swe/features/daemon-status-rpc.md`: all six TODO(verify) items resolved (list() excludes archived, relay close path fixed in task-005, `startedAt` = bootstrap start, `clients[]` uncapped, baseline alignment, `Session` defaults) and the refinements recorded (no `curated-packs` re-export, flag moves to s085). `packages/protocol/AGENTS.md` already documented the `daemon_status_*` schemas (task-002) and stays accurate.

## Files created / changed
| File | Change |
|------|--------|
| `packages/server/AGENTS.md` | layout + Observability section |
| `swe/features/daemon-status-rpc.md` | TODOs resolved, refinements |

## Build & test results
```
$ npm run build && npm run typecheck && npm run lint -> success (pre-existing warnings only)
$ npm test -> 254 files, 3374 tests passed
$ npm run fmt:check -> none of this sprint's changed files listed (baseline failures elsewhere)
```

## Acceptance criteria
- [x] Gates green: build, typecheck, lint, test; fmt:check clean for changed files (known baseline excluded).

## Follow-ups / TODO(verify)
- None.
