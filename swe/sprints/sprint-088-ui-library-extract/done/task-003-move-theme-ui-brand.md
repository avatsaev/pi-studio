# Task 003 — Move theme, `ui/` logic, brand runtime, breakpoints, kv-store into ui-library

- **Sprint:** sprint-088-ui-library-extract
- **Status:** done
- **Type:** refactor
- **Area:** packages/ui-library/src, packages/web-client/src
- **Priority:** P1
- **Estimated size:** M
- **Depends on:** task-002

## Goal
The React-light half of the design system lives only in ui-library; web-client imports it via `@av-pi-studio/ui-library` and behaves identically.

## Context / why
D3 (move, never copy), D6 (contents), D13 (kv-store moves). Invariant to preserve: no behaviour change; every existing test still passes from its new home.

## Scope references
- `swe/grills/ui-library.md` D3, D6, D13; § Codebase context; § Integration points
- `packages/web-client/src/theme/**` (all except `fonts.css`, which stays — terminal font is deferred), `ui/**`, `brand/config.ts`, `brand/theme-injection.ts`, `brand/index.ts`, `platform/breakpoints.ts`, `providers/kv-store.ts`
- `packages/web-client/vite.config.ts` (`resolve.alias`), `tsconfig.json` (`paths`), root `vitest.config.ts`

## What to build
- `git mv` the listed files into `packages/ui-library/src/{theme,ui,brand,breakpoints.ts,kv-store.ts}` (tests move with their modules). `brand/build-brand.ts` + its test **stay** in web-client (D6).
- Inside the library, replace every `@pi-studio-ui/...` import with a relative import — the library must not depend on any web-client alias.
- Library root `src/index.ts` re-exports the moved barrels (theme, ui, brand, breakpoints, `localStorageKvStore` — rename `localKvStore` → `localStorageKvStore` per D13).
- web-client: Vite `resolve.alias` `@av-pi-studio/ui-library` → `../ui-library/src/index.ts` (existing protocol/client pattern, D19); matching `tsconfig.json` `paths`; root `vitest.config.ts` alias; add `@av-pi-studio/ui-library` to web-client `devDependencies` (D23).
- Rewrite all web-client imports of moved modules to `@av-pi-studio/ui-library`.
- `theme/token-integrity.test.ts` + `theme/font-scale.test.ts`: move to `packages/web-client/src/` (e.g. `src/design-tokens.test.ts`) still scanning **web-client src**, importing `flattenThemeToVars` etc. from the library — keeps web-client coverage until s089/t005 replaces them. `font-scale` also reads `BUTTON_FONT_SIZE` from the library.

## Out of scope
- Primitives, toast/announcer stores, CSS reset (t004); alias rename (t005); any API change (`storageKey`, brand trim — s089).

## Acceptance criteria
- [x] None of the listed files exist under `packages/web-client/src` any more (except `brand/build-brand.ts`, `theme/fonts.css`).
- [x] No file under `packages/ui-library/src` imports `@pi-studio-ui`.
- [x] All moved tests pass from `packages/ui-library`; web-client guard tests still pass over web-client src.

## Test / verification plan
- Build: `npm run build:web-client` (and `npm run build` at sprint end) succeeds.
- Typecheck/Lint: `npm run typecheck`, `npm run lint`, `npx oxfmt --check <changed files>` clean.
- Tests: `npm test` green.
- Dev smoke: `npm run dev -w packages/web-client` starts and the app themes correctly (vars on `<html>`).

## Notes
`theme/index.ts` re-exports `ThemeBoundary` (React) — fine, the subpath split happens in s089/t001.
