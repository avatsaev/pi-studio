# Task 002 — Repository-level documentation — Summary

- **Sprint:** sprints/sprint-095-workbench-release
- **Completed:** 2026-11-14
- **Status:** done

## What was implemented
Rewrote the handoff doc's status table, plan table and "The workbench" section from planned to the built API (entries, region components, hooks, host contract, bundler constraints). Root AGENTS.md layout/release (eight packages, order, runbook, reading note). build-layering.md, CONTRIBUTING.md, MAIN-SCOPE.md, two spec status lines, and package AGENTS pointers retargeted from web-client to workbench.

## Files created / changed
| File | Change |
|------|--------|
| `AGENTS.md` | layout, release, pointers |
| `CONTRIBUTING.md` | layout + graph |
| `docs/build-layering.md` | graph, order, alias arrangement |
| `docs/desktop-client-handoff.md` | status, plan, workbench section |
| `swe/MAIN-SCOPE.md` | components, directory map, TODO ticks |
| `swe/architecture/workbench-package.md` | status line |
| `swe/architecture/workbench-host-adapter.md` | status line |
| `packages/{server,client,cli}/AGENTS.md` | pointers |
| `fern/docs.yml` | comment path |

## How it satisfies the scope
Docs only.

## Build & test results
```
Path-existence check over changed docs: only pre-existing or package-relative paths differ. rg for planned/not built in the handoff leaves only the protocol follow-ups (sprint 096). fern is not installed locally, so `fern check` was not run; the only fern change is a YAML comment.
```

## Acceptance criteria
['No document describes web-client as holding the features: met.', 'No planned/not built statement about the workbench in the handoff: met.', 'Paths exist: met.', 'fern check: not run (unavailable).']

## Follow-ups / TODO(verify)
- None.
