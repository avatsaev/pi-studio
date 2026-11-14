# Task 003 — Packed-tarball smoke: a consumer outside the workspace

- **Sprint:** sprint-094-workbench-build-api
- **Status:** done
- **Type:** test
- **Area:** packages/workbench (scripts)
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** task-002

## Goal
Prove the published artefact works for a consumer that is not `web-client`: installed from tarballs, no alias, no workspace resolution.

## Context / why
This is the only check that sees what the desktop repository will see.

## Scope references
- `swe/architecture/workbench-package.md` § Acceptance criteria (packed tarball, custom shell)
- `swe/notes/workbench-packaging-spike.md` (smoke form)
- `packages/ui-library/scripts/pack-smoke.sh` (precedent)
- `packages/workbench/README.md` quickstart (written in task-004; the smoke uses the same snippet)

## What to build
- `packages/workbench/scripts/pack-smoke.sh`: pack the workbench and the workspace packages it depends on (`protocol`, `relay`, `client`, `ui-library`), install the tarballs into a scratch Vite + React + TypeScript application outside the repository, and assert each step with a `PASS`/`FAIL` line.
- The scratch application has two entries: the whole application (`Workbench` with `createBrowserHost`, both stylesheets, the pdf.js plugin and worker); and a custom shell (`WorkbenchProvider`, `WorkbenchBoot`, `SessionList`, `PaneArea`, a connect button using `useConnection()`).
- Assertions: install succeeds; `tsc --noEmit` passes with `skipLibCheck: false`; `vite build` succeeds; heavy libraries (mermaid, shiki languages, pdf.js, the molecule viewer) are in lazy chunks and not in the entry chunk; a deep import fails to resolve; no `piwb-` class collides with the scratch app's own CSS Module names.
- Run-time check, driven by hand or by an agent with a browser: serve the built scratch app, start `npm run dev:daemon`, connect, send a prompt, see the mock turn stream, with no console errors, for both entries. Record the result in the task summary.
- `KEEP_DIR=1` keeps the scratch directory.
- Keep `docs/desktop-client-handoff.md` current: update whatever this task makes stale there (status table, workbench and host sections, wire facts, milestones, open questions). Say in the summary what changed in it, or that nothing did.

## Out of scope
- Adding a browser-automation dependency to the repository.
- Running the smoke in CI.

## Acceptance criteria
- [ ] The script prints only `PASS` lines and exits 0.
- [ ] The run-time check passes for both entries and is recorded.
- [ ] The script cleans up after itself unless `KEEP_DIR=1`.
- [ ] `docs/desktop-client-handoff.md` matches the repository after this task, or the summary states that nothing in it was affected.

## Test / verification plan
- `bash packages/workbench/scripts/pack-smoke.sh`
- Run-time check as described.

## Notes
- The dev daemon has no terminal or file-transfer handlers (until sprint 096 task-006), so the run-time check covers connection, sessions and a chat turn only.
