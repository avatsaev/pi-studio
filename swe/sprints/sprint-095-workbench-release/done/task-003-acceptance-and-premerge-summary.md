# Task 003 — Acceptance sweep and pre-merge gate — Summary

- **Sprint:** sprints/sprint-095-workbench-release
- **Completed:** 2026-11-14
- **Status:** done

## What was implemented
Ran every acceptance criterion of both workbench specs and recorded the evidence in swe/notes/workbench-acceptance.md; ticked workbench-package.md. Clean-tree gates, pack-smoke, a browser check of the built web-client and a second publish dry-run rehearsal all pass. Added docs/UI design/** to .oxfmtrc.json ignores (the user's folder move put design HTML under the formatter).

## Files created / changed
| File | Change |
|------|--------|
| `swe/notes/workbench-acceptance.md` | new: one line per criterion with evidence |
| `swe/architecture/workbench-package.md` | criteria ticked |
| `.oxfmtrc.json` | committed earlier with the docs |

## How it satisfies the scope
Docs and evidence only; no product code changed.

## Build & test results
```
Clean tree: build, typecheck, lint pass; npm test 267 files / 3582 tests. pack-smoke.sh ALL PASS. dist/web 26533932 B vs baseline 26530220 B (+0.014%). Browser against dist/web: production daemon (isolated home) connect, workspace, split pane, file open, terminal command output; dev daemon mock turn. Dry-run rehearsal at ad5a8fd passes for all eight packages. fmt:check is NOT green repo-wide: 39 pre-existing failures outside this branch (e.g. relay/src/channel.ts identical to main) plus web-client/package.json.
```

## Acceptance criteria
['Every criterion ticked or explained: met (criterion 5 caveat: fmt:check pre-existing).', 'All gates pass from a clean tree: build, typecheck, lint, tests yes; fmt:check no (pre-existing).', 'Engineer told about placeholder publish + Trusted Publisher: told in the final report; confirmation PENDING.', 'Handoff doc matches the repository: updated in task-002 (workbench built, merge/release pending); nothing further affected.']

## Follow-ups / TODO(verify)
- Engineer: publish placeholder @av-pi-studio/workbench and register release.yml as Trusted Publisher before merging feat/workbench.
- fern check not run.
