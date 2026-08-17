# Task 001 — The 36px strip band: one height declaration, `spacing-8` padding, transparent surface — Summary

- **Sprint:** sprint-061-workspace-tab-strip-redesign
- **Completed:** 2026-08-17
- **Status:** done

## What was implemented

Corrected the tab strip's band height from 33px to the already-written 36px
(`WORKSPACE_SECONDARY_HEADER_HEIGHT` in `platform/breakpoints.ts`, "Height 36" in
`workspace-ui.md:176`), declared exactly once as `--pane-strip-height` on `TabPanelHost.module.css`'s
`.area`, with every other consumer (`.strip`'s `min-height`, `pane-layout-view.ts`'s `calc()`s, the
`.empty`/`.emptyStack` offsets) reading that one custom property rather than restating a literal.
Restyled `.strip`'s padding to `0 var(--pi-spacing-8)` (from the old top-only
`spacing-4 spacing-6 0`, which existed to seat the previous top-radiused tab segments) and switched
the bottom border to token form (`var(--pi-border-width-1)`). No row-model or pill styling changed —
this task is reviewable purely as "the band grew 3px and lost its top padding."

## Files created / changed

| File | Change |
|------|--------|
| `packages/web-client/src/features/workspace/TabPanelHost.module.css` | `--pane-strip-height: 33px` → `36px`; comment updated to name `TabStrip.module.css`'s 36px row and `WORKSPACE_SECONDARY_HEADER_HEIGHT` |
| `packages/web-client/src/features/workspace/TabStrip.module.css` | `.strip`: `min-height: 33px` → `min-height: var(--pane-strip-height)`; padding → `0 var(--pi-spacing-8)`; border → `var(--pi-border-width-1)` token form; `.paneStrip`'s adjacent comment's "33px row" → "36px row" |
| `packages/web-client/src/features/workspace/pane-layout-view.ts` | `STRIP_HEIGHT`'s doc comment: "33px row" → "36px row", now also names `WORKSPACE_SECONDARY_HEADER_HEIGHT` |

## How it satisfies the scope

- **(a) 36 is a correction, not a change.** `platform/breakpoints.ts:41`'s constant and
  `workspace-ui.md:176`'s spec text were already 36; only the two CSS `33px` literals disagreed. Both
  are now 36.
- **(b) One declaration site.** `--pane-strip-height` is declared only in `TabPanelHost.module.css`'s
  `.area`; `.strip` inherits it through the DOM (CSS custom properties cross module boundaries — CSS
  Modules only scope class names) instead of restating the number, and `pane-layout-view.ts`'s
  `STRIP_HEIGHT = "var(--pane-strip-height)"` and every `calc()` built from it needed no edit.
- **(c) `--pane-*`, not `--pi-*`.** No rename attempted; the doc comment explaining why was preserved
  and only its stale number corrected.
- Band styling matches § 07: `spacing-8` side padding, 1px token-form bottom border, no `background`
  declared (the page's `--pi-color-background` shows through per `global.css:19`, unchanged).

## Build & test results

```
$ npm run build:web-client
✓ built in 12.84s

$ npm run typecheck
(clean, no output)

$ npx oxlint packages/web-client/src/features/workspace/TabStrip.module.css packages/web-client/src/features/workspace/TabPanelHost.module.css packages/web-client/src/features/workspace/pane-layout-view.ts
(clean, no output)

$ npx oxfmt --check packages/web-client/src/features/workspace/TabStrip.module.css packages/web-client/src/features/workspace/TabPanelHost.module.css packages/web-client/src/features/workspace/pane-layout-view.ts
All matched files use the correct format. (3 files)

$ npx vitest run packages/web-client/src/features/workspace
Test Files  7 passed (7)
     Tests  151 passed (151)

$ npx vitest run packages/web-client/src/theme
Test Files  2 passed (2)
     Tests  7 passed (7)
```

## Acceptance criteria

- [x] The strip renders exactly 36px tall (border-box) — `min-height: var(--pane-strip-height)` where
      the variable resolves to `36px`; `paneChrome()` sets an exact inline `height` for real panes
      that composes the same variable via `STRIP_HEIGHT`.
- [x] `33` appears nowhere in `packages/web-client/src/features/workspace/` as a strip-height literal
      (verified by search — only unrelated `33.3333%` fraction-formatting occurrences remain in
      `pane-layout-view.ts`'s `percent()` and its test), and `36px` appears exactly once, in
      `TabPanelHost.module.css`.
- [x] Each pane's body starts flush at the strip's bottom border: `.empty`/`.emptyStack`'s
      `top: var(--pane-strip-height)` now resolves to 36px, matching the strip's own height —
      confirmed by `pane-layout-view.test.ts`'s unedited symbolic `calc(… var(--pane-strip-height))`
      assertions passing.
- [x] Drop-preview alignment: `dropPreviewStyle()` composes `STRIP_HEIGHT` unedited;
      `pane-layout-view.test.ts` (paneStyle/paneChrome/occupiedPaneRects/panelBoxes suites) passes
      without modification, confirming no region's geometry broke.
- [x] `pane-layout-view.test.ts` passes without being edited — verified above (25 tests, unmodified
      file).
- [x] The band paints no surface of its own — no `background` declaration was added to `.strip`; the
      page background shows through unchanged.

## Follow-ups / TODO(verify)

- Visual confirmation (36px measured in devtools, 2×2 split alignment, empty-state offset, drag
  preview across all five regions, dark/light hairline check) is deferred to task-005's § 07
  pre-ship verification sweep, which covers the whole shipped strip in one pass rather than
  per-task — consistent with sprint-059/060's pattern.
