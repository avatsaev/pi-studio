# Task 004 — Dev-only warnings: missing `styles.css` sentinel, second `ThemeBoundary`

- **Sprint:** sprint-089-ui-library-build-api
- **Status:** done
- **Type:** feature
- **Area:** packages/ui-library/src/theme, primitives CSS
- **Priority:** P2
- **Estimated size:** S
- **Depends on:** task-001

## Goal
In development a consumer who forgot `styles.css`, or mounted two `ThemeBoundary`s, gets one clear console warning; production builds stay silent.

## Context / why
D25, D27. Tests run in Node without jsdom (repo convention), so the decision logic is a pure, injectable helper and `ThemeBoundary` only wires it.

## Scope references
- `swe/grills/ui-library.md` D25, D27; AC6
- `packages/ui-library/src/theme/ThemeBoundary.tsx`; a library CSS file included in `styles.css` (e.g. a tiny `src/sentinel.module.css` or a `:root` rule in an existing primitive module)

## What to build
- `styles.css` defines a sentinel custom property on `:root` (e.g. `--piui-stylesheet: 1`), **not** in `reset.css`.
- Pure helpers (e.g. `checkStylesheetLoaded(readVar)`, a module-level mounted-boundary counter with `register()/unregister()`), each warning at most once per page.
- `ThemeBoundary` calls them in an effect guarded by `process.env.NODE_ENV !== "production"`, preserved unreplaced in `dist` (see s089/t001 TODO).
- Warn texts name the fix (`import "@av-pi-studio/ui-library/styles.css"`; "only one ThemeBoundary per document").

## Out of scope
- Scoped/nested boundaries (non-goal).

## Acceptance criteria
- [x] AC6 (dev part): unit tests — sentinel absent → one warn; present → none; second registration → one warn; deregistration then re-registration → none.
- [x] Grep of a production consumer build (gallery in s090/t001, `NODE_ENV=production`) contains no warn strings.

## Test / verification plan
- Build: `npm run build:web-client` (and `npm run build` at sprint end) succeeds.
- Typecheck/Lint: `npm run typecheck`, `npm run lint`, `npx oxfmt --check <changed files>` clean.
- Tests: `npm test` green.
