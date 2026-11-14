# Task 001 — Feature branch + web-client build baseline

- **Sprint:** sprint-088-ui-library-extract
- **Status:** done
- **Type:** chore
- **Area:** repo / packages/web-client
- **Priority:** P1
- **Estimated size:** XS
- **Depends on:** none

## Goal
Open the single feature branch for the whole effort and record the pre-move web-client build baseline that the ±2% size budget (AC8) is checked against.

## Context / why
D31 forbids any partial state reaching `main` (every push publishes npm + Docker + deploys), so all three sprints land on one branch. D29's budget needs a measurement taken **before** any code moves.

## Scope references
- `swe/grills/ui-library.md` § Decisions D29, D31; § Acceptance criteria AC8
- `packages/web-client/vite.config.ts` (`manualChunks`, `dist/web` output)

## What to build
- Create branch `feat/ui-library` from `main` (clean tree).
- Run `npm run build:web-client` on the untouched tree; record into `swe/notes/ui-library-baseline.md`: total byte size of `packages/web-client/dist/web` (exact command used, e.g. `du -sb`), the sorted list of emitted chunk **name prefixes** (`vendor-overlays`, `vendor-icons`, …, hash stripped), and the size of each `.css` asset.
- Record the commit SHA the baseline was taken at.

## Out of scope
- Any source change.

## Acceptance criteria
- [x] `swe/notes/ui-library-baseline.md` exists with total size, chunk-name list, CSS asset sizes, SHA and the reproducible command.
- [x] Work happens on `feat/ui-library`, not `main`.

## Test / verification plan
- Re-run the recorded command twice; totals match (build is deterministic).
