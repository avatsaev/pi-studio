# Task 005 — Rename web-client's `@pi-studio-ui/*` alias to `@web-client/*`

- **Sprint:** sprint-088-ui-library-extract
- **Status:** done
- **Type:** refactor
- **Area:** packages/web-client, root vitest config
- **Priority:** P2
- **Estimated size:** S
- **Depends on:** task-004

## Goal
Zero `@pi-studio-ui` references remain anywhere; web-client's internal alias is `@web-client/*`.

## Context / why
D20: the old alias name is confusing next to the real `ui-library` package. Mechanical, behaviour-neutral; one cut, no shim.

## Scope references
- `swe/grills/ui-library.md` D20; AC2
- `packages/web-client/vite.config.ts`, `packages/web-client/tsconfig.json` (`paths`), root `vitest.config.ts`, every `packages/web-client/src/**` importer, `packages/web-client/AGENTS.md`/`README.md` mentions

## What to build
- Replace alias key in all three configs and every import (codemod via `ast_edit`/grep-driven edit, not sed).
- Update alias mentions in web-client docs touched by the rename (full docs pass is s090/t005).

## Out of scope
- Any other renames.

## Acceptance criteria
- [x] `rg '@pi-studio-ui' --hidden -g '!node_modules' -g '!swe/**'` returns nothing (historical swe/ docs excepted).
- [x] Build, typecheck, tests green.

## Test / verification plan
- Build: `npm run build:web-client` (and `npm run build` at sprint end) succeeds.
- Typecheck/Lint: `npm run typecheck`, `npm run lint`, `npx oxfmt --check <changed files>` clean.
- Tests: `npm test` green.
