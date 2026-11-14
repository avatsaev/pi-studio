# Task 004 — Size budget + full acceptance sweep

- **Sprint:** sprint-090-ui-library-consumers-release
- **Status:** done
- **Type:** test
- **Area:** packages/web-client, repo
- **Priority:** P1
- **Estimated size:** XS
- **Depends on:** task-001…task-003

## Goal
Prove AC1, AC2 and AC8 on the finished branch.

## Context / why
D29 budget against the s088/t001 baseline; AC2's no-duplication and no-alias greps.

## Scope references
- `swe/grills/ui-library.md` AC1, AC2, AC8
- `swe/notes/ui-library-baseline.md`

## What to build
- Rebuild web-client with the baseline's exact command; compare total size and chunk-name list; record both in the baseline note.
- AC2 greps: no moved module path under `packages/web-client/src`; zero `@pi-studio-ui`; web-client design-system imports only via `@av-pi-studio/ui-library`.
- If over budget: investigate (e.g. duplicated CSS from both source-compiled modules and reset) and fix before closing.

## Out of scope
- Visual parity (engineer, D34).

## Acceptance criteria
- [x] AC8: total within ±2%, chunk-name list identical.
- [x] AC1 + AC2 hold (`npm run build`, `typecheck`, `lint`, `test` green).

## Test / verification plan
- Build: `npm run build:web-client` (and `npm run build` at sprint end) succeeds.
- Typecheck/Lint: `npm run typecheck`, `npm run lint`, `npx oxfmt --check <changed files>` clean.
- Tests: `npm test` green.
