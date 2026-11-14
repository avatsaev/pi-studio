# Task 003 — Acceptance sweep and pre-merge gate

- **Sprint:** sprint-095-workbench-release
- **Status:** backlog
- **Type:** test
- **Area:** whole repository
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** task-001, task-002

## Goal
Run every acceptance criterion of the two workbench specs, then hand the branch to the engineer with the one manual step that must precede the merge.

## Context / why
Merging publishes. The package must exist on npm with a Trusted Publisher before the release workflow tries to publish it, or the release fails partway through.

## Scope references
- `swe/architecture/workbench-package.md` § Acceptance criteria
- `swe/architecture/workbench-host-adapter.md` § Acceptance criteria
- `swe/notes/workbench-baseline.md`
- `packages/workbench/RELEASING.md`

## What to build
- Write `swe/notes/workbench-acceptance.md`: one line per acceptance criterion of both specs with the command or observation that proves it.
- Full gates from a clean tree: `npm run clean && npm run build && npm run typecheck && npm run lint && npm run fmt:check && npm test`.
- Final browser check of `web-client` against a production daemon (the list from sprint 092 task-005).
- Tick the criteria in both spec files and set their status lines.
- Tell the engineer, explicitly, that before merging they must: publish a placeholder `@av-pi-studio/workbench` and register `release.yml` as its Trusted Publisher on npmjs.com. Do not merge.
- Keep `docs/desktop-client-handoff.md` current: update whatever this task makes stale there (status table, workbench and host sections, wire facts, milestones, open questions). Say in the summary what changed in it, or that nothing did.

## Out of scope
- Merging, pushing to `main`, publishing.
- Sprint 096.

## Acceptance criteria
- [ ] Every criterion in both specs is ticked or has a written, accepted reason.
- [ ] All gates pass from a clean tree.
- [ ] The engineer has been told about the placeholder publish and Trusted Publisher step, and the summary records their confirmation or that it is pending.
- [ ] `docs/desktop-client-handoff.md` matches the repository after this task, or the summary states that nothing in it was affected.

## Test / verification plan
- The commands above.
- `npm view @av-pi-studio/workbench dist-tags` once the engineer reports the placeholder is published.

## Notes
- The engineer said on 2026-11-14 that they will create the placeholder when told to. This task is where they are told.
