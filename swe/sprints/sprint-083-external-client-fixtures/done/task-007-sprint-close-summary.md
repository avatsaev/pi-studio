# Task 007 — Sprint close: publish fixtures in npm `files`, docs, spec amendments, gates — Summary

- **Sprint:** sprint-083-external-client-fixtures
- **Completed:** 2026-11-13
- **Status:** done

## What was implemented
- `packages/protocol/package.json` `files` += `fixtures` (the spike recommended it). `npm pack --dry-run -w @av-pi-studio/protocol` lists `fixtures/external-clients/*` including `.signatures.json` (14 kB).
- Docs: root `AGENTS.md` (Protocol overview bullet), `packages/server/AGENTS.md` (Layer B + recorder under Testing), `packages/protocol/AGENTS.md` (done in task-005).
- Spec `swe/architecture/external-client-fixtures.md`: status shipped; permission rows, dev-handle `permissionService` and permission scenario steps removed (family retired in sprint-086, deliberately unfixtured); version `0.1.0-dev`; `agent_status` / `agent_ui_resolved.cancelled` documented as exceptions; manifest `response`/`exception`, `direction: "http"`, stored signature pairs, scenario module and producers noted; the five TODO(verify)s resolved; acceptance criteria checked with evidence. `MAIN-SCOPE.md` row marked shipped (sprint-083).

## Files created / changed
| File | Change |
|------|--------|
| `packages/protocol/package.json` | `files` += `fixtures` |
| `AGENTS.md`, `packages/server/AGENTS.md` | docs |
| `swe/architecture/external-client-fixtures.md`, `swe/MAIN-SCOPE.md` | spec amendments, shipped marker |

## Build & test results (full gates, once)
```
$ npm run build       # success
$ npm run typecheck   # success
$ npm run lint        # 0 errors; no warnings in files changed by this sprint (pre-existing web-client warnings only)
$ npm run fmt:check   # 42 pre-existing files (baseline), none of this sprint's changed files except packages/protocol/package.json,
                      # which is in the baseline list because oxfmt wants to reorder its untouched "repository" key
$ npm test            # 250 files, 3447 tests passed, 0 failed
```

## Acceptance criteria
- [x] All spec acceptance criteria except the cross-repo dashboard round trip (informational) and stage 2 additions (arrive with sprints 084/085) are checked off with evidence
- [x] Gates green modulo the fmt baseline

## Follow-ups / TODO(verify)
- Stage 2 fixtures (`daemon_status_*`, `daemon_logs_*`) are added by sprints 084/085: author the file, add it to `manifest.json` (`stage: 2`, `requiresFeature`), add a scenario step to `test-support/external-fixtures-scenario.ts` + `variantKey`, run `fixtures:update`.
