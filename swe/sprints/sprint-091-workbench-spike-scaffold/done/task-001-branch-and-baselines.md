# Task 001 — Feature branch + pre-move baselines

- **Sprint:** sprint-091-workbench-spike-scaffold
- **Status:** done
- **Type:** chore
- **Area:** repo / packages/web-client
- **Priority:** P1
- **Estimated size:** XS
- **Depends on:** none

## Goal
Open the one feature branch for sprints 091–095 and record the numbers the move is checked against.

## Context / why
Every push to `main` publishes npm packages, Docker images and deploys, so no partial state may reach it: sprints 091–095 land on one branch and merge once. The spec's parity criteria (test count, `dist/web` size, chunk names, lazy imports) need measurements taken before any file moves.

## Scope references
- `swe/architecture/workbench-package.md` § Acceptance criteria
- `swe/notes/ui-library-baseline.md` (format precedent)
- `packages/web-client/vite.config.ts` (`manualChunks`, `dist/web`)

## What to build
- Create branch `feat/workbench` from an up-to-date `main`. The uncommitted scope and plan documents travel with it.
- Write `swe/notes/workbench-baseline.md` with: the commit SHA; total bytes of `packages/web-client/dist/web` after `npm run build:web-client`; the sorted list of emitted chunk-name prefixes (hash stripped); the number of test files and tests reported by `npx vitest run packages/web-client`; the number of non-test `.ts`/`.tsx` files under `packages/web-client/src`; the list of dynamic `import(` sites in non-test sources.
- Record the exact command used for each number.
- Keep `docs/desktop-client-handoff.md` current: update whatever this task makes stale there (status table, workbench and host sections, wire facts, milestones, open questions). Say in the summary what changed in it, or that nothing did.

## Out of scope
- Any source change.

## Acceptance criteria
- [ ] `swe/notes/workbench-baseline.md` exists with every value above and a reproducible command for each.
- [ ] Work happens on `feat/workbench`, not `main`.
- [ ] Two consecutive builds give the same total size.
- [ ] `docs/desktop-client-handoff.md` matches the repository after this task, or the summary states that nothing in it was affected.

## Test / verification plan
- Re-run each recorded command once; values match the note.

## Notes
- Planning-time figures to sanity-check against: 227 non-test source files, 109 test files, 452 `@web-client/` imports in 151 files.
- A web-client dev server from an earlier session may still be running as the managed service `web-client-dev`; stop it before building if it interferes.
