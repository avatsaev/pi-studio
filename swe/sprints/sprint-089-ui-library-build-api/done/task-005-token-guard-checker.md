# Task 005 — Export the token-integrity checker; per-package guard tests

- **Sprint:** sprint-089-ui-library-build-api
- **Status:** done
- **Type:** feature
- **Area:** packages/ui-library/src/theme, packages/web-client tests
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** task-001

## Goal
A React-free `/theme` export validates any set of CSS/TS sources against the real emitted tokens; ui-library and web-client each run it over their own sources.

## Context / why
D21. Replaces the two moved guard tests (s088/t003) without shrinking coverage: dangling `--pi-*`/`--syntax-*` refs, illegal emitted keys, literal `font-size` px/rem, `BUTTON_FONT_SIZE` rung mapping.

## Scope references
- `swe/grills/ui-library.md` D21; AC7
- web-client `src/design-tokens.test.ts` (from s088/t003), original logic of `token-integrity.test.ts` + `font-scale.test.ts`
- `packages/ui-library/src/theme/`

## What to build
- `findTokenProblems(files: { path: string; text: string }[]): TokenProblem[]` (name may differ) — pure, no `node:fs`, exported from `/theme`. Also exported: the emitted-key legality check.
- ui-library test reads its own `src` (node:fs in the test only) and asserts no problems + the sanity floor of var references.
- web-client test replaced by a thin caller over web-client `src`.

## Out of scope
- Gallery's guard test (s090/t001).

## Acceptance criteria
- [x] AC7: injecting `var(--pi-color-nope)` or `font-size: 12px` into a fixture fails the checker (unit tests on in-memory files); both package tests pass on the real trees.
- [x] Checker has no `node:` imports.

## Test / verification plan
- Build: `npm run build:web-client` (and `npm run build` at sprint end) succeeds.
- Typecheck/Lint: `npm run typecheck`, `npm run lint`, `npx oxfmt --check <changed files>` clean.
- Tests: `npm test` green.
