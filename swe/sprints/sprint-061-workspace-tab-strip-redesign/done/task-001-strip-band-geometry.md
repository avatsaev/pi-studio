# Task 001 — The 36px strip band: one height declaration, `spacing-8` padding, transparent surface

- **Sprint:** sprint-061-workspace-tab-strip-redesign
- **Status:** done
- **Type:** feature
- **Area:** packages/web-client (workspace)
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** none

## Goal

Make the pane's tab strip the 36px chrome band § 07 specifies — `spacing-8` side padding, a 1px
bottom border, no surface of its own — and collapse the two hard-coded `33px` literals that define
the band today into a single declaration site, so the strip's height and every `calc()` derived from
it can never drift again.

## Context / why

`swe/UI design/redesign 0.1.0/Redesign Handoff Spec.dc.html` § 07:

> **Strip geometry.** Height `WORKSPACE_SECONDARY_HEADER_HEIGHT` (36), `spacing-8` side padding, 1px
> bottom `border`, transparent background — the strip does not get its own surface step; the pane's
> `surface0` shows through.

Three grounded facts decide how this lands:

**(a) 36 is already the written constant; only the CSS disagrees.**
`platform/breakpoints.ts:41` declares `WORKSPACE_SECONDARY_HEADER_HEIGHT = 36` ("tab strip / panel
toolbars") and `swe/features/workspace-ui.md:176` has always specified "Height 36". The shipped strip
is 33px (`TabStrip.module.css:5`), mirrored a second time as `--pane-strip-height: 33px`
(`TabPanelHost.module.css:8`). This is a correction to the code, not a change to the spec.

**(b) The pane geometry is already symbolic, so the fix is one value.** `pane-layout-view.ts:30`
holds `STRIP_HEIGHT = "var(--pane-strip-height)"` and every consumer composes that string:
`paneStyle()` (`:70-77`, panel body `top`/`height`), `dropPreviewStyle()` (`:86-112`, all five
regions), `paneChrome()` (`:140`, the strip's own inline `height`), plus
`TabPanelHost.module.css:38,50` (`.empty`/`.emptyStack` offsets). `pane-layout-view.test.ts:53,55,61,
62,82` asserts those `calc(… var(--pane-strip-height))` strings **symbolically**, so it stays green
without edits — the number lives in exactly one CSS declaration. The remaining duplicate is
`TabStrip.module.css`'s own `min-height: 33px`, which exists only for the no-pane-style case; since
`.strip` always renders inside `TabPanelHost`'s `.area` (`TabPanelHost.tsx:121-131` — both the
`chrome.length === 0` inert strip and the per-pane strips), the var inherits and that literal can
reference it instead of restating it.

**(c) `--pane-*`, not `--pi-*`, is deliberate.** `pane-layout-view.ts:21-29` records why: `--pi-*` is
reserved for theme-emitted tokens and `theme/token-integrity.test.ts` fails any `var(--pi-…)` the
theme does not emit. This is a component-local layout metric. Do not "promote" it to a `--pi-` name,
and do not import `WORKSPACE_SECONDARY_HEADER_HEIGHT` into the CSS via an inline style — a CSS module
declaration is the cheaper single source of truth; cite the constant in a comment instead.

The strip has no `background` today and the ambient behind it is the page background
(`global.css:19` — `.area`/`.panel` set none), so § 07's "the pane's `surface0` shows through" is
already true in this app's token vocabulary as `--pi-color-background`. Per § 01's RULE ("if a mock
and this app's token guide disagree, the token guide wins"), the strip stays background-less and
every hover mix in this sprint bases on `--pi-color-background`, not `surface0`.

## Scope references

- `swe/UI design/redesign 0.1.0/Redesign Handoff Spec.dc.html` § 07 (strip geometry + the
  `TabStrip.module.css` reference block), § 02 (token mapping), § 01 (token guide wins)
- `swe/features/workspace-ui.md:175-183` — § Desktop tab strip ("Height 36")
- `packages/web-client/src/platform/breakpoints.ts:41` — `WORKSPACE_SECONDARY_HEADER_HEIGHT = 36`
- `packages/web-client/src/features/workspace/TabStrip.module.css:1-10` — `.strip`
- `packages/web-client/src/features/workspace/TabPanelHost.module.css:1-9,33-51` — `--pane-strip-height`,
  `.empty`/`.emptyStack`
- `packages/web-client/src/features/workspace/pane-layout-view.ts:21-30,51-112,132-142` — `STRIP_HEIGHT`
  and every consumer
- `packages/web-client/src/features/workspace/pane-layout-view.test.ts:53,55,61,62,82` — symbolic
  assertions that must stay green unedited
- `packages/web-client/src/features/workspace/TabPanelHost.tsx:121-131` — both strip render sites
- `packages/web-client/src/global.css:19` — the page background the band shows through
- Modify: `TabStrip.module.css`, `TabPanelHost.module.css`, `pane-layout-view.ts` (comment only)

## What to build

**1. One height.** `TabPanelHost.module.css:8` becomes `--pane-strip-height: 36px`, with its comment
naming `platform/breakpoints.ts`'s `WORKSPACE_SECONDARY_HEADER_HEIGHT` as the spec constant it
matches. `TabStrip.module.css`'s `.strip` drops the `33px` literal and uses
`min-height: var(--pane-strip-height)` (inherited from `.area`). Update
`pane-layout-view.ts:21-25`'s doc comment, which currently says "33px row", so no comment lies about
the geometry.

**2. Band styling.** `.strip` padding becomes `0 var(--pi-spacing-8)` (from
`var(--pi-spacing-4) var(--pi-spacing-6) 0` — the top-only padding existed to seat the old
top-radiused segments and has no place under a vertically centred pill). Keep `align-items: center`,
keep `gap: var(--pi-spacing-2)`, keep `overflow: hidden` and `flex-shrink: 0`, and switch the bottom
border to the token form `border-bottom: var(--pi-border-width-1) solid var(--pi-color-border)`.
Leave `.focused`'s accent bottom-border override and `.paneStrip`'s absolute placement untouched.

**3. Nothing else moves.** No row-model change (`.tabs` vs actions is task 003), no pill styling
(task 002). This task must be reviewable as "the band grew 3px and lost its top padding".

## Out of scope

- Pill/tab styling, truncation, icons, close affordance — tasks 002 and 004.
- The `.tabs`/`+`/split row model and `margin-left: auto` — task 003.
- Any change to `pane-dnd.ts`: `resolveDropRegion()` reads already-measured body bounds
  (`pane-dnd.ts:47-64`, and see its `containsPoint()` comment) and is strip-height agnostic. Drop
  zones shift 3px because their measured rect does; that is the fix working, not a change to make.
- Promoting `--pane-strip-height` to a `--pi-*` token, or deriving it from the TS constant at
  runtime.
- Moving `TurnProgressBar` — see task 004's Out of scope for why it stays in `ChatPanel`.

## Acceptance criteria

- [ ] The strip renders exactly 36px tall (border-box, bottom border included) in the single-pane
      case and in every pane of a 2×2 split.
- [ ] `33` appears nowhere in `packages/web-client/src/features/workspace/` (verified by search), and
      `36px` appears exactly once — in `TabPanelHost.module.css`.
- [ ] Each pane's body starts flush at the strip's bottom border: no 3px gap, no overlap, and the
      `.empty` / `.emptyStack` messages sit below the band.
- [ ] Dragging a tab over a pane paints a drop preview whose top edge aligns with the pane body's top
      edge in all five regions (left/right/top/bottom/center).
- [ ] `pane-layout-view.test.ts` passes **without being edited**.
- [ ] The band paints no surface of its own: the page background shows through, and only the bottom
      border separates it from the body.

## Test / verification plan

- Build: `npm run build:web-client`. Typecheck: `npm run typecheck`.
- Lint/format: `npx oxlint <changed files>`, `npx oxfmt --check <changed files>`.
- Tests: `npx vitest run packages/web-client/src/features/workspace` (pane-layout-view + pane-dnd +
  pane-tree), then `npx vitest run packages/web-client/src/theme` for the token guards.
- Manual (`npm run dev:daemon` + web client): measure the strip in devtools (36px border-box); split
  into 2×2 and confirm all four bands and bodies line up; open a workspace with no tabs to check the
  empty-state offset; drag a tab over each pane region and watch the preview's top edge; check `dark`
  and `light` (the border must still read as a hairline, not a black rule).

## Notes

- `min-height` (not `height`) on `.strip` is intentional and pre-existing: `paneChrome()` sets an
  exact inline `height`, so the CSS value only backstops the inert no-workspace strip. Keep it as
  `min-height` so a pane's inline height always wins.
- Do not delete `TabStrip.module.css`'s `overflow: hidden`; it is what keeps a squashed pill from
  painting over the neighbouring pane once task 002 makes tabs shrinkable.
