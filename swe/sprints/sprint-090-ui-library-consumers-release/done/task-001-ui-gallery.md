# Task 001 — `packages/ui-gallery`: private gallery consuming ui-library `dist`

- **Sprint:** sprint-090-ui-library-consumers-release
- **Status:** done
- **Type:** feature
- **Area:** packages/ui-gallery (new)
- **Priority:** P1
- **Estimated size:** M
- **Depends on:** sprint-089 (all)

## Goal
A private Vite + React app renders every exported primitive in all six themes against the **built** library, proving standalone consumption, and is part of the root build.

## Context / why
D2, D9 (private, never published/deployed, built in the pipeline), D19 (consumes `dist` via `exports`, **no alias**). Planning-time decision (brief open question): name/location `packages/ui-gallery`, `"private": true`.

## Scope references
- `swe/grills/ui-library.md` D2, D9, D19, D21; AC4
- `packages/ui-library/dist` exports; root `package.json`

## What to build
- Vite + React 19 app; deps `@av-pi-studio/ui-library` (workspace), `react`, `react-dom`. No `resolve.alias` for the library.
- Entry imports `reset.css` + `styles.css`, wraps in `<ThemeBoundary>` with no props, mounts `<ToastViewport/>` + `<Announcer/>`.
- One page: a theme switcher (all six `THEME_NAMES`, uses the appearance controller/hook), a section per exported primitive with its main variants, a button that fires a toast and an announcement.
- Thin token-guard test over gallery `src` (s089/t005 checker).
- Root: workspace + `build:ui-gallery`; `build` runs it after ui-library (and before cli). Excluded from `publish.sh`.

## Out of scope
- Deploying or publishing the gallery (non-goal).

## Acceptance criteria
- [x] AC4: `npm run build` builds the gallery from library `dist`; gallery source contains no path into `packages/ui-library/src`.
- [x] One browser check (dev server or `vite preview`): every primitive renders themed; switching through all six themes restyles live; toast appears; no console warnings in dev.

## Test / verification plan
- Build: `npm run build:web-client` (and `npm run build` at sprint end) succeeds.
- Typecheck/Lint: `npm run typecheck`, `npm run lint`, `npx oxfmt --check <changed files>` clean.
- Tests: `npm test` green.
- Browser: open the gallery, switch all 6 themes, trigger toast; capture one screenshot per theme into the task summary.
