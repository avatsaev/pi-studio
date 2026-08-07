# Task 001 — Expose the resolved theme to components (appearance context)

- **Sprint:** sprint-053-terminal-fidelity
- **Status:** backlog
- **Type:** refactor
- **Estimated size:** XS
- **Depends on:** none

## Goal
Give components a way to read the resolved `Theme` object, so a surface that cannot consume CSS
variables — an emulator configured through JavaScript — can follow the app's theme, mono font, and
font-size setting.

## Background / why
The appearance system is complete and correct up to the CSS boundary: `appearance-store.ts` resolves
`{ mode, settings, resolvedTheme }`, persists it under `pi-studio-appearance`, follows system dark
mode, and applies brand accent injection; `theme.ts:107-117` scales **every** font rung from the
user's 10–24 px `fontSize` setting; `colors.ts:196,266,311` builds a full per-variant `TerminalTheme`
(background/foreground/cursor/selection + 16 ANSI colors) for both dark and light.

None of it is reachable from a component. `ThemeBoundary.tsx:24-30` keeps the controller in a private
`useRef` and its only output is `applyThemeToDOM` → CSS custom properties. `css-bridge.ts:113-118`
deliberately emits just two of the terminal colors (`--pi-terminal-bg`, `--pi-terminal-fg`) with the
comment "Terminal colors are not CSS variables (consumed by xterm config directly)" — but nothing
consumes them directly, because nothing can.

This is why `TerminalPanel.tsx:51-73` carries a hardcoded 19-colour `TERMINAL_THEME` literal and
`fontSize: baseFontSize.sm` (the **unscaled** token): a light theme leaves the terminal dark, a brand
accent never reaches its cursor, and the font-size setting does nothing there. Task-002 fixes that and
needs this seam first.

The alternative — emitting all ~19 colours as CSS variables and reading them back with
`getComputedStyle` — is rejected: it string-round-trips data we already hold, and it cannot deliver the
numeric font size that the emulator needs as a number.

## Scope references
- `swe/architecture/design-system.md` § Colors (`colors.terminal` is "the full xterm
  theme (background/foreground/cursor/selection + 16 ANSI colors)"), § Scales
- `swe/features/feature-panels-ui.md` § Terminal pane → Pi-Studio implementation contract
  (appearance sourcing is mandatory)
- `packages/web-client/src/theme/ThemeBoundary.tsx`
- `packages/web-client/src/theme/appearance-store.ts` (`AppearanceController`, `AppearanceState`)
- `packages/web-client/src/theme/theme.ts` (`Theme`, `applyAppearance`)
- `packages/web-client/src/theme/index.ts` (public surface of the theme module)

## What to build
- A React context published by `ThemeBoundary` carrying the current `AppearanceState` (or at minimum
  `resolvedTheme`), plus a `useAppearance()` / `useResolvedTheme()` hook exported from
  `theme/index.ts`.
- The context value must **change identity when the theme changes** so consumers re-render: today
  `apply()` mutates the DOM and `update()` rebuilds `state`, but nothing notifies React. Add the
  minimal subscription needed (the controller already owns `update()`/`listen()`; expose a
  subscribe/notify or lift the state into `useState`/`useSyncExternalStore` inside `ThemeBoundary`).
- Preserve the pre-first-paint guarantee: `apply()` must still run synchronously during the first
  render (`ThemeBoundary.tsx:26-30`), so no flash of the wrong theme is introduced. The context is
  additive.
- No behaviour change for CSS-variable consumers: `flattenThemeToVars`/`applyThemeToDOM` output stays
  byte-identical, including the two `--pi-terminal-*` variables (`TerminalPanel.module.css` uses
  `--pi-terminal-bg` for the wrapper background).

## Out of scope
- Consuming the context anywhere — task-002 is its first consumer.
- Adding a settings UI for `fontSize`/`monoFont`/theme mode (no such UI exists yet; the setting is
  reachable through the controller and persisted storage).
- Changing which tokens are emitted as CSS variables.

## Acceptance criteria
- [ ] A component can read the resolved `Theme` (including `colors.terminal`, `fontSize`, and
      `fontFamily.mono`) through a hook, with no `getComputedStyle` and no string parsing.
- [ ] Changing the theme mode or appearance settings through the controller re-renders consumers with
      the new `Theme`; a system dark-mode change does the same via the existing `listen()` path.
- [ ] Theme CSS variables are applied synchronously on first render exactly as before (no flash), and
      the emitted variable set is unchanged.
- [ ] Existing theme tests pass unchanged, including `theme/font-scale.test.ts`.
- [ ] `npm run build`, `npm run typecheck`, `npm run lint`, `npm test` pass.

## Test / verification plan
- Unit: `npx vitest run packages/web-client/src/theme` — existing suites must pass untouched; add a
  test for the context's state-change notification only if it can be exercised without a DOM (the
  controller itself is plain TypeScript, so a subscribe/notify contract on it is testable).
- Build/typecheck/lint/tests: `npm run build`, `npm run typecheck`, `npm run lint`, `npm test`.
- Manual: load the app, toggle the OS between light and dark → CSS-variable-driven surfaces still
  follow instantly and nothing flashes on reload.

## Notes
`injectBrandAccent` (`brand/theme-injection.ts`) patches only the accent family and leaves the
terminal map alone by design — that comment stays true after this change; task-002 consumes
`colors.terminal` as built, not a brand-overridden variant.
