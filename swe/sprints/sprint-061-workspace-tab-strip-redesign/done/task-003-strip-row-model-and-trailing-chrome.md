# Task 003 — Strip row model: ＋ beside the last tab, split controls pinned right

- **Sprint:** sprint-061-workspace-tab-strip-redesign
- **Status:** done
- **Type:** feature
- **Area:** packages/web-client (workspace)
- **Priority:** P2
- **Estimated size:** S
- **Depends on:** task-001, task-002

## Goal

Give the strip § 07's three-part row model — shrinkable tabs, then ＋ immediately after the last tab,
then `margin-left: auto` and the two split buttons hard-pinned to the right edge — and move the three
controls' styling out of inline `style` props into the module.

## Context / why

§ 07:

> **Trailing chrome, in this order:** ＋ (opens the existing new-tab `Menu`), then `margin-left:auto`,
> then split-vertical and split-horizontal `IconButton`s (`size="xs"`, `hoverBase` = the pane's
> ambient surface). All three are `flex:none`.

and its reference block ends with:

> `.stripActions { margin-left: auto; display:flex; gap: var(--pi-spacing-8); flex: none; }`

**Why the current DOM cannot produce that layout.** `.tabs` is `flex: 1 1 auto`
(`TabStrip.module.css:13-20`), so it eats all free space and shoves ＋ against the split buttons at
the far right — ＋ reads as part of the split cluster instead of as "add one more of these". Changing
`.tabs` to `flex: 0 1 auto` (shrink, never grow) puts ＋ next to the last pill and lets a
`.stripActions` wrapper claim the right edge with `margin-left: auto`. The wrapper is new: today the
two `IconButton`s are bare siblings (`TabStrip.tsx:168-209`).

**Keep the split that made the buttons reachable.** `.tabs` must stay a separate scroll container with
the actions outside it — that is sprint-049's fix for split buttons scrolling out of reach in a narrow
pane (`TabStrip.module.css:11-12`, `AGENTS.md:270-274`), and task 002's pill floor means overflow is
still reachable. Do not flatten the tabs into `.strip` even though § 07's reference block shows a
single flex container; its mock has four tabs and no scroll model.

**`hoverBase` is already right, and `size="xs"` is nearly right.**
`components/primitives/IconButton.tsx:24-29` documents `hoverBase` as "the matching token for the
button's ambient background"; all three controls already pass `var(--pi-color-background)`, which is
what shows through the band (`global.css:19`; see task 001 § (c)). `size` defaults to `"xs"` (20px)
and the split buttons pass it explicitly while ＋ does not — make all three explicit so the strip
does not depend on a primitive's default. The three inline `style={{ borderRadius:
"var(--pi-radius-sm)" }}` props (`:131,190,200`) become one CSS rule; inline styles in this file exist
only for dnd transforms.

## Scope references

- `swe/UI design/redesign 0.1.0/Redesign Handoff Spec.dc.html` § 07 (trailing chrome order + the
  `.stripActions` rule), § 07 DO NOT (don't hand-roll a menu — `Menu*` exists)
- `swe/features/workspace-ui.md:181-183` — the trailing actions cluster
- `packages/web-client/src/features/workspace/TabStrip.tsx:112-154` — `NewTabMenu`
- `packages/web-client/src/features/workspace/TabStrip.tsx:156-209` — `SplitActions` and its
  `canSplit` refusal reasons
- `packages/web-client/src/features/workspace/TabStrip.tsx:222-259` — the strip's render tree
- `packages/web-client/src/features/workspace/TabStrip.module.css:11-20,71-84` — `.tabs`, `.newTab`,
  `.splitAction`, `.itemIcon`
- `packages/web-client/src/components/primitives/IconButton.tsx:24-29` — `size`, `hoverBase`
- `packages/web-client/src/components/primitives/Menu.tsx` — `MenuContent`/`MenuItem` (unchanged)
- Modify: `TabStrip.tsx`, `TabStrip.module.css`

## What to build

**1. Row model.** `.tabs` becomes `flex: 0 1 auto` (keep `min-width: 0`, `overflow-x: auto`,
`align-items: center`, `gap: var(--pi-spacing-2)`). ＋ stays the immediate next sibling of `.tabs`,
`flex: none`. Wrap the two split buttons in a `.stripActions` element:
`margin-left: auto; display: flex; align-items: center; gap: var(--pi-spacing-8); flex: none;`.

**2. Control styling in the module.** `.newTab` and `.stripAction` carry
`border-radius: var(--pi-radius-sm)` and `flex: none`; delete all three inline `style` props. Pass
`size="xs"` on all three `IconButton`s and keep `hoverBase="var(--pi-color-background)"`.

**3. Icon sizing.** The three control glyphs (`Plus`, `Columns2`, `Rows2`) and the ＋ menu's three item
glyphs currently pass raw `size={14}` / `size={13}`. Route them through the `Icon` primitive at
`size="sm"` (14px) for the controls and `size="xs"` (12px) for the menu items, matching task 002's
`Icon`-only rule for this file. `.itemIcon`'s `flex-shrink: 0` + muted color stays.

**4. Behavior is frozen.** `NewTabMenu`'s pane targeting and `workspaceCwd === null` guard,
`SplitActions`' `splitEmpty` + `openNewChat` seeding and its two `canSplit` refusal tooltips, and the
strip-level `useDroppable` + `onPointerDown` → `focusPane` all stay exactly as they are. This task
moves boxes; it changes no decision.

## Out of scope

- Pill styling and truncation (task 002), attention dot (task 004).
- Adding controls § 07 does not list (no overflow-menu, no pane-close button, no keyboard chords, no
  "New browser tab").
- Replacing `overflow-x: auto` with a scroll-button affordance.
- Touching `pane-tree.ts`'s `canSplit` or the split depth cap.

## Acceptance criteria

- [ ] With one tab in a wide pane, ＋ sits immediately right of that pill (one `spacing-2` gap), and
      the two split buttons are flush against the strip's right padding edge.
- [ ] With enough tabs to overflow, ＋ and both split buttons remain visible and clickable without
      scrolling; only the tabs scroll.
- [ ] The three controls are 20px `IconButton`s (`size="xs"`) with `radius-sm`, hover-lifting off the
      pane's ambient background, and no inline `style` prop remains in `TabStrip.tsx` except the
      dnd transform.
- [ ] Split-right / split-down still work, and both still disable with "Open a workspace to split" /
      "Maximum split depth reached" as appropriate.
- [ ] The ＋ menu still opens New chat / New terminal / New molecule view into **this** pane, and is
      disabled with no workspace open.
- [ ] Clicking anywhere on the strip (including its empty middle) still focuses the pane.

## Test / verification plan

- Build: `npm run build:web-client`. Typecheck: `npm run typecheck`.
- Lint/format: `npx oxlint <changed files>`, `npx oxfmt --check <changed files>`.
- Tests: `npx vitest run packages/web-client/src/features/workspace`, then
  `npx vitest run packages/web-client`.
- Manual (`npm start`): in a wide pane and again in a ~300px pane, confirm the ＋/split positions and
  reachability; split to depth 4 and confirm the refusal tooltips; open each ＋ menu entry and confirm
  it lands in the clicked pane, not the previously focused one; click the strip's empty area of an
  unfocused pane and confirm the focus indicator moves.

## Notes

- ＋ must stay a sibling of `SortableContext`, never inside it (`TabStrip.tsx:104-111` explains why —
  GitHub issue #8: a sortable ＋ poisons `closestCenter` collision detection). Wrapping the *split*
  buttons is safe; do not also wrap ＋ into `.stripActions`, or § 07's order breaks.
- `IconButton`'s `size="sm"` is 28px and would blow the 24px pill rhythm; `xs` is the correct rung
  even though the glyph inside is 14px.
