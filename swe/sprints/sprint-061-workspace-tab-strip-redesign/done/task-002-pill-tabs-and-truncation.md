# Task 002 — Soft-pill tabs, mandatory truncation, per-kind icon via the `Icon` primitive

- **Sprint:** sprint-061-workspace-tab-strip-redesign
- **Status:** done
- **Type:** feature
- **Area:** packages/web-client (workspace)
- **Priority:** P1
- **Estimated size:** M
- **Depends on:** task-001

## Goal

Turn each tab from a full-height, top-radiused bordered segment into the redesign's 24px soft pill
that **shrinks and ellipsises its own label** instead of reserving 160px and pushing everything else
out of the strip — § 07 calls the current behavior "the single worst defect of the current strip".

## Context / why

§ 07, verbatim:

> **Tab = 26px pill.** `radius-md`, `spacing-10` horizontal padding, `gap: spacing-7` between icon,
> label, and close. Active: `surface2` fill + `foreground` text. Inactive: no fill,
> `foregroundMuted` text, hover-lift on hover. No borders, no bottom underline on tabs — the
> underline treatment belongs to the Files/Changes panel tabs only, so the two never read as the same
> control.
>
> **Truncation is mandatory.** Each tab is `flex: 0 1 auto; min-width: 0` with `white-space: nowrap`
> on the pill and `overflow: hidden; text-overflow: ellipsis` on the label span only — icon, status
> dot, and × stay `flex: none`. A long file name must shrink its own pill, never wrap it to two lines
> or push ＋ and the split buttons off the strip.
>
> **Leading glyph states the pane kind** at `icon-size-xs` via `Icon`: chat (`MessageSquare`,
> accentBright when that session is the active one), file (`File`, name in `font-mono` at
> `font-size-2xs`), terminal (`SquareTerminal`), viewer (`Box`).
>
> **Close affordance.** × is always rendered on the active tab; on inactive tabs it follows
> `hoverVisible` (always shown on compact/touch). Its box is reserved either way so the label width
> doesn't jump on hover.

**What actually causes the defect.** `TabStrip.module.css:41` sets `flex-shrink: 0` on `.tab` and
`:56-60` clamps `.label` at `max-width: 160px`, so each pill has a ~210px hard floor
(160 label + 13 icon + 16 padding + ~20 close) and never gives any of it back. Five tabs in a 400px
pane cannot fit, so `.tabs`' `overflow-x: auto` (`:13-20`) becomes the only escape hatch.

**Four decisions this task locks in, because the spec was written against a mock with four tabs and
no scroll model:**

**(a) Pill height is `var(--pi-spacing-24)` (24px), not 26px.** `theme/tokens.ts:8-28`'s spacing
ladder has no `26` rung, § 02's mapping row offers either "`--pi-spacing-24` + 1px×2" (a border this
design explicitly removes) or "add a `26` spacing key", and § 07's DO NOT list forbids scale churn.
§ 07's own `TabStrip.module.css` reference block already writes `height: var(--pi-spacing-24)` — the
prose's 26 is the mock's border-box. 24px inside a 36px band gives 6px above and below; the mock's is
5px. If § 06's FileExplorer sprint later needs a real 26px row rung, it can add the key then, with two
consumers to justify it.

**(b) A pill needs a *floor*; only the label may shrink to zero.** `min-width: 0` alone lets flexbox
squash a pill until its `flex: none` icon and × overflow the box (clipped, unreadable, unclickable).
So: `min-width: 0` + `overflow: hidden` + `text-overflow: ellipsis` on the **label span**, and on the
pill `flex: 0 1 auto; min-width: var(--pi-spacing-64); max-width: 200px`. The 64px floor is roughly
icon + a couple of glyphs + × + padding; the 200px cap is the number
`swe/features/workspace-ui.md:176` has always specified. Once the floors no longer fit,
`.tabs`' existing `overflow-x: auto` takes over — which is exactly the fallback that written scope
already documents ("if even icon-only doesn't fit, enable horizontal scroll") and is why the trailing
chrome must live outside `.tabs` (task 003).

**(c) Icons go through the `Icon` primitive, not raw lucide `size={13}`.**
`components/primitives/Icon.tsx:8-34` maps `size="xs"` → 12px, which is § 07's `icon-size-xs`; the
current `size={13}` is a font rung wearing an icon's clothes. `ICON_BY_KIND` is exported and also
consumed by `DropPreview.tsx:14,26` for the floating drag chip, so a swap there is one edit with two
render sites.

**(d) `molecule` keeps `Atom`.** § 07 names a generic "viewer (`Box`)" kind this app does not have;
this app's kind is `molecule`, `Atom` reads correctly for it, and `Box` would be strictly less
informative. `file` → `File` and `terminal` → `SquareTerminal` are adopted as specified (note
`TerminalSquare` is lucide's deprecated alias of `SquareTerminal` — confirm both `File` and
`SquareTerminal` exist in the installed `lucide-react` before editing). `diff` keeps `GitCompare`;
§ 07 does not cover it.

**The close affordance has no JS width source, and does not need one.** `hoverVisible(isHovered,
isNative, isCompact)` (`components/primitives/helpers.ts:38-44`) is the documented rule
(`swe/architecture/design-system.md` § Hover-to-show pattern), but nothing in `packages/web-client`
wires a live width into it — `platform/breakpoints.ts:30` exposes `isCompactFormFactor(width)` and has
no hook. Express the same rule in CSS: hover/focus-gated by default, always visible under
`@media (max-width: 575px), (hover: none)` (575 = `breakpoints.sm` 576 minus 1). CSS media queries are
already the house idiom (`ScreenTitle.module.css:18`), and the box is reserved either way, so nothing
reflows on hover.

## Scope references

- `swe/UI design/redesign 0.1.0/Redesign Handoff Spec.dc.html` § 07 (pill, truncation, leading glyph,
  close affordance, the `TabStrip.module.css` reference block), § 02 (token mapping, the 26px row
  note), § 07 DO NOT (no unicode glyph icons; no new scale keys)
- `swe/features/workspace-ui.md:175-183` — icon-only minimum / 200px max / scroll fallback
- `packages/web-client/src/features/workspace/TabStrip.tsx:51-102` — `ICON_BY_KIND`, `TabItem`
- `packages/web-client/src/features/workspace/TabStrip.module.css:31-70` — `.tab`, `.active`,
  `.icon`, `.label`, `.close`
- `packages/web-client/src/features/workspace/DropPreview.tsx:14,26` — the drag chip's `ICON_BY_KIND`
  consumer
- `packages/web-client/src/components/primitives/Icon.tsx:8-34` — `size="xs"` = 12px, `color` prop
- `packages/web-client/src/components/primitives/helpers.ts:38-44` — the `hoverVisible` rule being
  mirrored in CSS
- `packages/web-client/src/platform/breakpoints.ts:7-13,30-33` — `sm: 576`, `isCompactFormFactor`
- `packages/web-client/src/theme/tokens.ts:8-28,47-70,71-109,114-120` — spacing / font-size / radius /
  icon-size ladders
- `packages/web-client/src/stores/tab-store.ts:29-47,68-80` — `TabKind`, `Tab`
- Modify: `TabStrip.tsx` (`ICON_BY_KIND`, `TabItem`), `TabStrip.module.css`

## What to build

**1. `.tab` as a pill.** `flex: 0 1 auto`, `min-width: var(--pi-spacing-64)`,
`max-width: 200px`, `height: var(--pi-spacing-24)`, `padding: 0 var(--pi-spacing-10)`,
`gap: var(--pi-spacing-7)`, `border-radius: var(--pi-radius-md)` (all four corners — the old
`md md 0 0` segment shape goes), `font-size: var(--pi-font-size-2xs)`, `color:
var(--pi-color-foregroundMuted)`, `white-space: nowrap`, `overflow: hidden`, `user-select: none`,
`cursor: pointer`. No border, no underline, ever. Delete `flex-shrink: 0`.

**2. States.** `.tab:hover` keeps the app-wide hover-lift, based on the strip's ambient
(`color-mix(in srgb, var(--pi-color-background) 85%, var(--pi-color-foreground) 15%)` — unchanged
from today). Active becomes `background: var(--pi-color-surface2); color: var(--pi-color-foreground)`
(it is `surface0` today, which now reads as "same as the pane body"). Rename the class to
`.tabActive` to match § 07's block and to stop `.active` colliding conceptually with
`TabPanelHost.module.css`'s own `.active` panel class.

**3. Label spans.** `.tabLabel { min-width: 0; overflow: hidden; text-overflow: ellipsis; }`, and
`.tabLabelMono { font-family: var(--pi-font-mono); }` applied for `file` and `diff` kinds (both are
paths). The font rung stays `--pi-font-size-2xs` for every kind — § 07's 11.5px mono rounds to the
same 12px rung per § 02's rounding rule, so mono and sans labels share one line box. Keep the
existing `title={tab.label}` so the full label is still discoverable when truncated.

**4. Icon.** `<Icon icon={ICON_BY_KIND[tab.kind]} size="xs" aria-hidden />` inside a `.tabIcon`
(`flex: none`) span. When the tab is active **and** `kind === "chat"`, pass
`color="var(--pi-color-accentBright)"` (§ 07: accentBright when that session is the active one);
every other case inherits the pill's text color. Update `ICON_BY_KIND`: `file: File`,
`terminal: SquareTerminal`, `chat: MessageSquare`, `diff: GitCompare`, `molecule: Atom` (decision
(d)). Fix the map's type annotation if the imported symbol used in `typeof …` changes.

**5. Reserved, hover-gated close.** `.tabClose { flex: none; }` with the box always present for a
closable tab. Visibility: `opacity: 0` by default, `1` on `.tabActive`, on `.tab:hover`, and on
`.tab:focus-within`; plus `@media (max-width: 575px), (hover: none) { opacity: 1 }`. Use `opacity`
(not `display`/`visibility` toggling of the element) so the pill's width never changes and the label's
ellipsis point is stable. Keep the existing click/`stopPropagation` handler and middle-click
behavior byte-for-byte.

**6. Drag chip parity.** Re-check `DropPreview`'s chip after the icon swap — it renders
`ICON_BY_KIND[tab.kind]` at its own size and must still show an icon for every kind.

## Out of scope

- The `.tabs` / `+` / split-actions row model and `margin-left: auto` — task 003.
- The attention `StatusDot` between label and × — task 004 (it is `flex: none` in the same row; leave
  the gap rule ready for it, add no placeholder).
- Turning the × into a real `<button>` / adding `aria-label`s / keyboard tab-close. The current × is a
  `<span onClick>` with no accessible name; upgrading it is a genuine a11y fix with its own
  verification, and smuggling it into a visual sprint hides it from review. Interaction semantics stay
  exactly as they are.
- Skeleton bars for loading tabs (`workspace-ui.md:177`) — never implemented, not implemented here;
  task 005 marks it as such in the scope doc rather than deleting the line.
- Adding a `26` spacing key, an `icon-size` variant, or any new token.
- Files/Changes panel tabs (§ 06) — explicitly a different control per § 07.

## Acceptance criteria

- [ ] A tab with a 60-character label shrinks its own pill and ellipsises the label; it never wraps to
      two lines, never grows past 200px, and never pushes ＋ or the split buttons out of the strip.
- [ ] With eight tabs in a ~300px pane, pills shrink to their floor, `.tabs` scrolls horizontally, and
      the trailing chrome stays visible and clickable without scrolling.
- [ ] The active tab reads as a `surface2` pill with `foreground` text; inactive tabs have no fill and
      `foregroundMuted` text and lift on hover. No tab has a border or an underline in any state.
- [ ] Icon, status area and × never shrink or clip while a label is truncating.
- [ ] The active chat tab's `MessageSquare` is `accentBright`; other kinds' icons inherit the pill
      color; every icon is a lucide glyph at 12px through `Icon` (no raw `size={13}`, no unicode).
- [ ] × is visible on the active tab and on hover/keyboard-focus of an inactive one; the pill's width
      and the label's truncation point are byte-identical hovered vs not.
- [ ] Below 576px (or with a coarse pointer) every closable tab shows its ×.
- [ ] `file`/`diff` labels render in `--pi-font-mono`; all labels share the `2xs` rung.
- [ ] Click to activate, middle-click to close, × to close, and drag-reorder all behave exactly as
      before.
- [ ] `token-integrity.test.ts` and `font-scale.test.ts` pass; no new token or scale key was added.

## Test / verification plan

- Build: `npm run build:web-client`. Typecheck: `npm run typecheck`.
- Lint/format: `npx oxlint <changed files>`, `npx oxfmt --check <changed files>`.
- Tests: `npx vitest run packages/web-client/src/theme` then `npx vitest run packages/web-client`
  (stores must stay green; there are no DOM tests by project convention — `AGENTS.md` § Testing).
- Manual (`npm start` so terminals/files work, not `dev:daemon`): open a chat, a terminal, a
  molecule view and a deep-path file in one pane; shrink the window and the pane until pills hit the
  floor and the strip scrolls; hover and unhover an inactive tab watching the label's last character
  for movement; keyboard-focus a tab's × ; emulate a touch device for the coarse-pointer branch;
  drag a tab to reorder, to another pane, and onto a pane edge; check `dark`, `light` and `zinc` (on
  `zinc` the near-white accent must not make the active chat icon vanish against `surface2`).

## Notes

- `.tabs`' `overflow-x: auto` is load-bearing under this model, not vestigial: the pill floor means
  overflow is still reachable with enough tabs. `packages/web-client/AGENTS.md:270-274` describes the
  old "non-shrinking tabs in a scroll container" model — task 005 rewrites that paragraph.
- Keep `TabItem`'s dnd wiring (`useSortable`, `attributes`, `listeners`, the `isDragging` opacity)
  untouched; this is a styling + markup change inside the existing draggable node.
- The `.icon`/`.label`/`.close` class renames are internal to this module plus `TabStrip.tsx`; no test
  or other module references them (verified: no `styles.` imports of `TabStrip.module.css` elsewhere).
