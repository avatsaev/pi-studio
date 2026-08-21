# Task 002 — Terminal follows the theme, mono font, and font-size setting — Summary

- **Sprint:** sprint-053-terminal-fidelity
- **Completed:** 2026-08-21
- **Status:** done

## What was implemented
`TerminalPanel` now sources its emulator's colours, font size, and font family from
`useAppearance()` (task-001) instead of the hardcoded `TERMINAL_THEME` literal and unscaled
`baseFontSize.sm`. The `Terminal` constructor uses `theme.colors.terminal` / `theme.fontSize.code` /
a derived `terminalFontFamily` at mount time; a new appearance-sync `useEffect` (deps
`[theme, terminalFontFamily]`) updates `terminal.options.{theme,fontSize,fontFamily}` in place on
every subsequent appearance change, without recreating the terminal. Colour writes are unconditional
and cheap; a font size/family change (which alters cell metrics — a genuine viewport change) is the
only thing that triggers `requestRefit()`, reusing sprint-052's coalesced refit + `claimSize` seam. A
`prevFontRef` guards the effect's first run (which fires in the same commit as construction, applying
the exact values the constructor just used) from misreading that redundant re-application as a change.

**One deliberate deviation from the task's literal instruction**, documented in code: the terminal's
default font family is `TERMINAL_FONT_STACK` (tokens.ts — Nerd Font aware, for shell prompts like
starship/powerlevel10k that paint glyphs `DEFAULT_MONO_FONT` doesn't contain), not
`theme.fontFamily.mono` unconditionally. `applyAppearance` falls the *unset* `monoFont` case back to
`DEFAULT_MONO_FONT`, so reading `theme.fontFamily.mono` directly would have silently broken glyph
rendering for every terminal user who hasn't set a custom font — the common case. The real signal for
"the user configured a custom mono font" is `settings.monoFont` (from `useAppearance()`), not the
resolved `fontFamily.mono` value; when set, it's honored verbatim. This is the same default/override
pattern `theme.ts` already uses for `DEFAULT_MONO_FONT`, just scoped to the terminal's own default.

## Files created / changed
| File | Change |
|------|--------|
| `packages/web-client/src/features/terminal/TerminalPanel.tsx` | deleted `TERMINAL_THEME` literal + `baseFontSize` import; added `useAppearance()`, `terminalFontFamily` derivation, appearance-sync effect, `prevFontRef` |

## How it satisfies the scope
Matches `feature-panels-ui.md` § Terminal pane (appearance sourcing) and `design-system.md` §
Colors. `colors.ts`'s `TerminalTheme` shape is a strict subset of xterm's `ITheme` (all fields
present in both, `string` assignable to `string?`) — no boundary adapter needed, confirmed by a
clean typecheck with no cast. `--pi-terminal-bg`/`-fg` (css-bridge.ts, unchanged) and the emulator
now both read from the identical `colors.terminal` object, so there is no seam by construction.

## Build & test results
```
$ npx vitest run packages/web-client/src/theme packages/web-client/src/features/terminal
 Test Files  4 passed (4)
      Tests  31 passed (31)

$ npx tsc -b packages/web-client --force
(clean)

$ npx oxlint packages/web-client/src/features/terminal/TerminalPanel.tsx
(clean, 0 warnings, 0 errors)

$ npm run build:web-client
✓ built in ~10s (unchanged bundle warnings, pre-existing)
```

## Live verification (production daemon + real PTY, `npm start` + `vite` dev server, browser-driven)
Reached the running `AppearanceController` singleton via its React fiber (`ThemeBoundary`'s
`useRef` hook state) to drive live, no-reload appearance changes — the only way to exercise this
task's in-place update path today, since no settings UI exists yet. WS frames observed by patching
`WebSocket.prototype.send`.

1. **Baseline**: dark theme, `stty size` → `51 116`, font 13px (`theme.fontSize.code`), font-family
   the Nerd Font stack (no custom `monoFont` set — confirms the deviation above works as designed).
2. **`setMode("light")`** (no reload): `--pi-terminal-bg`→`#ffffff`, `.xterm-viewport` computed
   `background-color` → `rgb(255, 255, 255)`, text `rgb(26, 26, 30)` (matches `buildLightColors`'
   foreground `#1a1a1e`) — **zero** WS frames sent (`window.__wsFrames` diff = `[]`) — scrollback/prompt
   text unchanged in the DOM (no PTY recreation).
3. **`updateSettings({ fontSize: 24 })`**: rendered `.xterm-rows` font-size → `18px` (13 × 24/17,
   rounded — exact `applyAppearance` scale math), exactly **one** binary frame with opcode `3`
   (`TerminalOpcode.Resize`) sent, and a live `stty size` inside the real shell reported `36 83` (down
   from `51 116`) — the daemon's PTY genuinely resized.
4. **`updateSettings({ monoFont: "Courier New" })`**: `.xterm-rows` computed `font-family` →
   `"Courier New"`, exactly one more `Resize` frame sent (Courier's metrics differ from the Nerd Font
   stack, so cell width changed).

This exercises the in-place update path (no remount, no reload) that the automated suite cannot —
`TerminalPanel` requires jsdom, which is not established test infrastructure in this repo.

## Acceptance criteria
- [x] Grep shows no palette literal and no `baseFontSize` import in `features/terminal/`.
- [x] Switching to light theme turns the terminal light — verified live (step 2 above).
- [x] Changing the appearance font size rescales, refits, and claims: `stty size` reports fewer
      columns — verified live (step 3: `51 116` → `36 83`, one `Resize` frame).
- [x] Setting a custom mono font applies to the terminal, refits, and claims — verified live (step 4).
- [x] A theme change that alters only colours sends no `Resize` frame — verified live (step 2: 0 frames).
- [x] Scrollback/subscription/size-claim triggers from sprint-052 unaffected — prompt content and
      history persisted across every live change; no PTY recreation observed.
- [x] `npm run build`, `npm run typecheck`, `npm run lint`, `npm test` pass (package-scoped above; full suite at sprint close).

## Follow-ups / TODO(verify)
- The daemon (`sprint053-daemon`, `npm start`) and web-client dev server (`web-dev`, vite on :5173)
  from this verification are left running for the rest of this sprint's live checks (task-003,
  task-005, task-006) rather than restarted per task.
