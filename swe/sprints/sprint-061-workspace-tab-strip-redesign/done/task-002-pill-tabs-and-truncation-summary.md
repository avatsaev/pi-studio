# Task 002 — Soft-pill tabs, mandatory truncation, per-kind icon via the `Icon` primitive — Summary

- **Sprint:** sprint-061-workspace-tab-strip-redesign
- **Completed:** 2026-08-17
- **Status:** done

## What was implemented

Replaced the full-height, top-radiused, `flex-shrink: 0` tab segment (which reserved a ~210px floor
per pill and never gave it back — § 07's "single worst defect") with a 24px soft pill that shrinks
and ellipsises its own label before the strip ever scrolls: `flex: 0 1 auto`, a `spacing-64` floor, a
200px cap, `radius-md` on all four corners, no border/underline in any state. The active pill now
reads as `surface2` + `foreground` (was `surface0`, which read as "same as the pane body" after
task-001's transparent band). The leading kind glyph and the close glyph both route through the
`Icon` primitive at `size="xs"` (12px) instead of raw `lucide` `size={13}`; `ICON_BY_KIND` now maps
`file → File`, `terminal → SquareTerminal` (adopted per spec) and keeps `molecule → Atom` (a
deliberate deviation from § 07's generic "viewer (`Box`)" — this app's kind is `molecule`, not a
generic viewer). The close box is always rendered for a closable tab and toggled with `opacity`
(active tab, hover, keyboard-focus, or a compact/coarse-pointer media query), never `display`, so a
label's truncation point never shifts on hover.

## Files created / changed

| File | Change |
|------|--------|
| `packages/web-client/src/features/workspace/TabStrip.tsx` | `ICON_BY_KIND` updated (`File`, `SquareTerminal`); added `MONO_LABEL_KINDS` lookup; `TabItem` rewritten to render the pill markup (`Icon` primitive for leading glyph + close, `tabActive`/`tabIcon`/`tabLabel`/`tabLabelMono`/`tabClose` classes); `NewTabMenu`'s "New terminal" raw glyph renamed `TerminalSquare` → `SquareTerminal` to keep the build green (its conversion to the `Icon` primitive is task-003's scope) |
| `packages/web-client/src/features/workspace/TabStrip.module.css` | `.tab`/`.active`/`.icon`/`.label`/`.close` rewritten as `.tab`/`.tabActive`/`.tabIcon`/`.tabLabel`/`.tabLabelMono`/`.tabClose`: pill geometry, floor+cap, opacity-gated reserved close box, compact/coarse-pointer media query |

## How it satisfies the scope

- **(a) `spacing-24` pill, not 26px.** `height: var(--pi-spacing-24)` — no `26` rung exists in
  `theme/tokens.ts`'s spacing ladder and § 07's own CSS reference block already writes
  `var(--pi-spacing-24)`.
- **(b) Floor + cap, not `min-width: 0` alone.** `.tab` is `flex: 0 1 auto; min-width:
  var(--pi-spacing-64); max-width: 200px`; only `.tabLabel` (`min-width: 0; overflow: hidden;
  text-overflow: ellipsis`) shrinks to zero. `.tabs`' pre-existing `overflow-x: auto` remains the
  fallback once floors no longer fit (untouched this task — task-003's `.tabs` edit).
- **(c) `Icon` primitive, not raw `size={13}`.** Both the leading kind glyph and the close glyph in
  `TabItem` render through `<Icon icon={...} size="xs" aria-hidden />`. `ICON_BY_KIND`'s exported
  values are consumed unmodified by `DropPreview.tsx`'s `DragChip` (still a raw `<Icon size={13}/>`
  render there by design — task-002's "Modify" list does not include `DropPreview.tsx`; it renders
  every kind's icon unchanged after the map swap, confirmed by `tsc -b` passing with no error at that
  call site).
- **(d) `molecule` keeps `Atom`.** Confirmed `File` and `SquareTerminal` exist in the installed
  `lucide-react` (`node_modules/lucide-react/dist/lucide-react.d.ts`) before wiring them in.
- Close visibility mirrors `hoverVisible` in CSS (no live width is fed to the JS helper in this
  package): `opacity: 1` on `.tabActive`, `.tab:hover`, `.tab:focus-within`, and unconditionally under
  `@media (max-width: 575px), (hover: none)` (575 = `breakpoints.sm` 576 − 1).
- `file`/`diff` labels get `.tabLabelMono` (`font-family: var(--pi-font-mono)`); every kind shares the
  `2xs` font rung per § 02's rounding rule.
- Click-to-activate, middle-click-to-close, ×-to-close, and drag-reorder wiring (`useSortable`,
  `attributes`, `listeners`, the `isDragging` opacity) are untouched — this task changed markup and
  styling inside the existing draggable node only.

## Build & test results

```
$ npm run build:web-client
✓ built in 12.95s   (after fixing a build-breaking stale `TerminalSquare` reference in
                      `NewTabMenu`, discovered by the first build attempt)

$ npm run typecheck
(clean, no output)

$ npx oxlint packages/web-client/src/features/workspace/TabStrip.tsx packages/web-client/src/features/workspace/TabStrip.module.css
(clean, no output)

$ npx oxfmt --check packages/web-client/src/features/workspace/TabStrip.tsx packages/web-client/src/features/workspace/TabStrip.module.css
Format issues found in TabStrip.tsx → fixed with `npx oxfmt packages/web-client/src/features/workspace/TabStrip.tsx` (scoped, 1 file); re-checked clean.

$ npx vitest run packages/web-client/src/features/workspace
Test Files  7 passed (7)
     Tests  151 passed (151)

$ npx vitest run packages/web-client/src/theme
Test Files  2 passed (2)
     Tests  7 passed (7)

$ npx vitest run packages/web-client
Test Files  57 passed (57)
     Tests  779 passed (779)
```

## Acceptance criteria

- [x] A tab with a 60-character label shrinks its own pill and ellipsises the label; it never wraps
      (`white-space: nowrap` + `.tabLabel`'s ellipsis), never grows past 200px (`max-width: 200px`),
      and never pushes ＋/split off the strip (`.tabs`' own `flex: 1 1 auto` still eats the free space
      today — task-003 fixes that row-model piece specifically; this task's pill itself never exceeds
      its cap regardless).
- [x] With eight tabs in a ~300px pane, pills shrink to their floor and `.tabs` scrolls horizontally
      (`.tabs`' pre-existing `overflow-x: auto`, unedited this task); full reachability of the trailing
      chrome without scrolling is task-003's row-model change — deferred to that task's acceptance and
      task-005's sweep, as scoped.
- [x] Active tab reads `surface2` + `foreground`; inactive tabs have no fill, `foregroundMuted`, and
      lift on hover; no border/underline in any state — verified in source (no `border` declared
      anywhere in the new block).
- [x] Icon, `.tabIcon`, and `.tabClose` are `flex: none` — never shrink or clip while the label
      truncates.
- [x] Active chat tab's leading icon gets `color="var(--pi-color-accentBright)"`; every other
      case inherits `currentColor` (the pill's text color); every glyph in `TabItem` is a lucide icon
      through `Icon` at 12px — no raw `size={13}`, no unicode.
- [x] × visible on the active tab and on hover/keyboard-focus of an inactive one via `opacity`
      (never `display`) — pill width and truncation point are unaffected by the toggle.
- [x] Below 576px or with a coarse pointer, every closable tab shows its × (`@media (max-width:
      575px), (hover: none)`).
- [x] `file`/`diff` labels render in `--pi-font-mono` via `.tabLabelMono`; all labels share the `2xs`
      rung (`.tab`'s `font-size`).
- [x] Click/middle-click/×/drag-reorder behavior byte-identical — no handler logic touched, only
      markup/class names around the same elements.
- [x] `token-integrity.test.ts` and `font-scale.test.ts` pass; no new token or scale key was added
      (`--pi-spacing-64`, `--pi-radius-md`, `--pi-font-size-2xs` all pre-existed).

## Follow-ups / TODO(verify)

- A project lint rule (`ts-set-map`) fired mid-task on an initial `Set<TabKind>` for
  `MONO_LABEL_KINDS`; replaced with `Partial<Record<TabKind, true>>` per the rule (static
  string-keyed lookup table), confirmed clean afterward.
- Full reachability of ＋/split controls while `.tabs` scrolls (today `.tabs` is still `flex: 1 1
  auto`, task-003's edit) and the visual/manual sweep (hover-unhover flicker check, keyboard-focus,
  coarse-pointer emulation, `dark`/`light`/`zinc`) are deferred to task-005's § 07 pre-ship
  verification, per this sprint's established per-task-then-sweep pattern (sprint-059/060).
