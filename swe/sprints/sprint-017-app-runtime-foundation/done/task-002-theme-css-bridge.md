# Task 002 — Theme → CSS variables bridge & appearance application

- **Sprint:** sprint-017-app-runtime-foundation
- **Status:** backlog
- **Estimated size:** M
- **Depends on:** task-001; sprint-012/task-001 (theme system logic)

## Goal
Render the sprint-012 theme tokens + six variants as **CSS custom properties** on `:root`, with runtime
appearance switching and system (`prefers-color-scheme`) following — the DOM replacement for Unistyles.

## Scope references
- `clean-room-scope/architecture/design-system.md` § Theme token shape, § six theme variants, § Purpose
  (render-stack decision)
- `clean-room-scope/features/white-label-branding.md` (brand theme injection)

## What to build
- A `applyTheme(theme)` that flattens the theme object (`colors.*`, `spacing`, `fontSize`, `radii`, …)
  into `--pi-*` CSS custom properties set on `document.documentElement`, plus `colors.syntax` →
  `--syntax-*` and `colors.terminal` → xterm theme object.
- A small CSS-Modules helper convention + a global `tokens.css` documenting the variable names; a
  `useTheme()`/`useThemeName()` hook backed by the theme store (from sprint-012) + a `KeyValueStore`
  persistence key for the chosen appearance.
- Appearance resolution: explicit variant | "system" → follow `matchMedia('(prefers-color-scheme:dark)')`
  live. Wire the brand theme-injection (`packages/app/src/brand/theme-injection.ts`) into the applied
  variables so white-label overrides land at build/boot.
- A `ThemeBoundary` component that applies the theme before first paint (no flash of wrong theme).

## Out of scope
- Providers/query/session (task-003). Router (task-004). Component styling beyond the token layer.

## Acceptance criteria
- [ ] Switching variant updates `--pi-*` variables live; "system" follows OS scheme changes.
- [ ] The six variants each produce the documented surface/text/accent ramps as CSS variables.
- [ ] Brand overrides (from the branding config) are reflected in the applied variables.
- [ ] Chosen appearance persists across reloads via `KeyValueStore`.

## Test / verification plan
- Tests: token-flattening (theme object → variable map) determinism; appearance resolution incl.
  system-follow; brand override merge. (jsdom for `matchMedia`/`documentElement`.)

## Notes
- Keep the token→variable name map exported so components and tests share one source of truth.
- TODO(verify): appearance storage key name — reuse the sprint-012 decision.
