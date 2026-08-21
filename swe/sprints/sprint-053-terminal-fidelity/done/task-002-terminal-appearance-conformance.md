# Task 002 — Terminal follows the theme, mono font, and font-size setting

- **Sprint:** sprint-053-terminal-fidelity
- **Status:** done
- **Type:** bugfix
- **Estimated size:** S
- **Depends on:** task-001

## Goal
Replace `TerminalPanel`'s hardcoded palette and unscaled font size with the resolved theme's
`colors.terminal`, appearance-scaled font size, and `fontFamily.mono`, and refit + claim the new size
when a font change alters cell metrics.

## Background / why
`feature-panels-ui.md` § Terminal pane already requires this — "theme from the terminal color tokens,
user mono font, code font size, configured scrollback" — and `design-system.md` § Colors already
defines `colors.terminal` as "the full xterm theme (background/foreground/cursor/selection + 16 ANSI
colors)", built per variant by `colors.ts:204` (`terminalFrom`) with a light-mode override at `:319`. So this is
conformance to written scope, not a new feature.

What ships instead: `TerminalPanel.tsx:120-143` is a hardcoded 19-colour dark literal with the comment
"Dark palette matching the app's github-dark-ish default theme", plus
`fontSize: baseFontSize.sm` — the raw token, not the appearance-scaled one — and a literal
`fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace"` that ignores
`fontFamily.mono`. Consequences: switching to the light theme leaves the terminal dark against a light
wrapper; the 10–24 px font-size setting (`theme.ts:107-117`, which scales every rung) does nothing in
the terminal; a custom mono font applies everywhere except the terminal.

The font size is not only cosmetic here. Cell width and height derive from it, so changing it changes
how many columns fit — which makes it a **genuine viewport change** under
`terminals.md` § PTY size ownership and therefore a size claim, exactly like a divider drag.

## Scope references
- `swe/features/feature-panels-ui.md` § Terminal pane → Rendering, and the Pi-Studio
  implementation contract's closing paragraph (appearance sourcing is mandatory; a font change MUST
  refit then claim)
- `swe/architecture/design-system.md` § Colors (`colors.terminal`), § Scales
- `swe/features/terminals.md` § PTY size ownership (font change = genuine viewport change)
- `packages/web-client/src/features/terminal/TerminalPanel.tsx` (`TERMINAL_THEME`, the `Terminal`
  options, the refit/claim seams from sprint-052)
- `packages/web-client/src/theme/colors.ts` (`TerminalTheme`, `terminalFrom`)
- `packages/web-client/src/theme/tokens.ts` (`baseFontSize` — the *unscaled* table; must not be read
  directly any more)
- `packages/web-client/src/features/terminal/TerminalPanel.module.css` (`--pi-terminal-bg` wrapper
  background — keep, it must agree with the emulator's own background)

## What to build
- Read the resolved theme via task-001's hook. Pass `theme.colors.terminal` straight through as the
  emulator's theme, and `theme.fontSize.code` + `theme.fontFamily.mono` as its font options —
  `code` is the spec's "code font size" rung (`tokens.ts:70`; 13 px at the default setting, where
  today's unscaled `baseFontSize.sm` is 14 px — a deliberate 1 px conformance change, not a
  regression). Delete the `TERMINAL_THEME` literal and the direct `baseFontSize` import — a second
  palette beside `colors.terminal` is exactly the duplicate convention the design system exists to
  prevent.
- Verify `TerminalTheme`'s shape against xterm's `ITheme` and adapt at the boundary if a key differs;
  do not reshape `colors.ts` to match a library type.
- On a theme/appearance change, update the live emulator in place (`terminal.options.theme`,
  `terminal.options.fontSize`, `terminal.options.fontFamily`) rather than recreating it — recreating
  loses scrollback and, worse, re-runs the mount path.
- After a **font** change (size or family) the cell metrics changed, so: refit through sprint-052's
  coalesced refit seam, then let `claimSize` send the resulting grid. A pure colour change must NOT
  refit or claim anything.
- Keep `scrollback: 5000`; the spec says "configured scrollback" and there is no scrollback setting
  yet — note it rather than inventing one.

## Out of scope
- Adding an appearance/settings UI for font size, mono font, or theme mode.
- A terminal-specific font-size or palette override (one appearance source, not two).
- Adding a scrollback setting.
- The WebGL/canvas renderer addon (see the sprint's open questions).

## Acceptance criteria
- [x] Grep shows no palette literal and no `baseFontSize` import in `features/terminal/`; the only
      sources are the resolved theme's `colors.terminal`, `fontSize`, and `fontFamily.mono`.
- [x] Switching to the light theme turns the terminal light — background, foreground, cursor, and ANSI
      colours all change, and the wrapper's `--pi-terminal-bg` matches the emulator's background with
      no seam.
- [x] Changing the appearance font size rescales the terminal's text, refits it, and claims the new
      grid: `stty size` reports fewer/more columns accordingly.
- [x] Setting a custom mono font applies to the terminal, refits, and claims.
- [x] A theme change that alters only colours sends **no** `Resize` frame.
- [x] Scrollback, subscription, and the size-claim triggers from sprint-052 are unaffected: a live
      terminal keeps its history across a theme change, and no PTY is recreated.
- [x] `npm run build`, `npm run typecheck`, `npm run lint`, `npm test` pass.

## Test / verification plan
- Unit: `npx vitest run packages/web-client/src/theme packages/web-client/src/features/terminal` —
  `theme/font-scale.test.ts` must still pass (the guard against font sizes that bypass the token scale).
- Build/typecheck/lint/tests: `npm run build`, `npm run typecheck`, `npm run lint`, `npm test`.
- Manual, against `npm start`, with the devtools WS frame list open:
  1. Open a terminal, note `stty size`. Switch theme dark→light→dark → colours follow; zero `Resize`
     frames; `stty size` unchanged; scrollback intact.
  2. Change the appearance font size to 10, then 24 → text rescales, one `Resize` per change at rest,
     `stty size` tracks each time, and the shell's wrap column matches the new width.
  3. Set a custom mono font → applies, refits, claims.
  4. Confirm with `pi-studio terminal ls` that the daemon's recorded cols/rows match after each change.
  (No appearance settings UI exists — the sprint-065 Settings dialog is Model Providers only. Drive
  the changes through the appearance controller, or edit the persisted `pi-studio-appearance`
  localStorage key and reload; both are the supported paths per task-001's out-of-scope note.)

## Notes
`ThemeBoundary` applies CSS variables synchronously before first paint, but the emulator is
constructed in an effect, so it always sees a resolved theme — there is no first-frame-wrong-colour
window to design around. Do not add one by deferring the theme read.
