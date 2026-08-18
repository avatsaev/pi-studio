# Task 002 — Workspace header as a full-bleed band

- **Sprint:** sprint-062-workspace-sidebar-redesign
- **Status:** done
- **Type:** feature
- **Area:** packages/web-client — features/sessions
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** task-001

## Goal

Rebuild `WorkspaceGroupHeader` as § 03's edge-to-edge `surface2` band: chevron tile, 20px avatar,
bold ellipsised name, collapsed-only attention dot, count pill, and a reserved (non-shifting) `⋮`
affordance — with the collapse/expand and menu behavior unchanged.

## Context / why

Today's header (`WorkspaceGroupHeader.tsx`, `SessionList.module.css:69-126`) is a `surfaceWorkspace`
row inside a `.workspaceGroup` wrapper that draws its own `border-bottom`, with a chevron that
swaps between two lucide glyphs, a `FolderClosed` icon, and a bare count span. § 03 replaces all of
it:

> **Workspace header = full-bleed band.** `surface2`, 1px `border` top and bottom, edge-to-edge (no
> side margin, no radius, no card frame). Same band whether expanded or collapsed — expansion is
> expressed only by the chevron rotation and the presence of session rows.
>
> **Header contents, in order:** chevron in a 16px `surface3` tile (rotate 90° when open) · 20px
> `Avatar` · name (`font-weight-bold`, ellipsis, never wraps) · optional `StatusDot` when collapsed
> and a child needs attention · session-count pill (`surface3`, `radius-full`).

Two things the mock cannot decide:

**(a) The band's surface is `surface2`, which retires `surfaceWorkspace`.** § 02 maps
`#232827 → --pi-color-surface2`, "workspace header band". `surfaceWorkspace`'s only two consumers
in the entire package are the two rules being rewritten here
(`SessionList.module.css:83` and `:93`), so after this task it is an emitted-but-unreferenced theme
key. Leave the key in `ThemeColors` (it is part of the theme contract, and
`token-integrity.test.ts` only checks reference → emitted, never the reverse) — task 005 fixes
`IconButton.tsx`'s doc comment, which cites it as an example ambient background.

**(b) The `⋮` stays.** § 03's mock shows no menu affordance, but "New conversation" and "Delete
workspace (all conversations)" exist only behind it (`WorkspaceContextMenu.tsx`) plus right-click.
Dropping it would delete shipped functionality, which is not what a restyle does. It follows the
strip's established reserved-box pattern (`TabStrip.module.css:73-97`): always occupying its box so
the label's truncation point never moves, `opacity`-gated on hover/`:focus-within`, and
unconditionally visible below `575px` or on a coarse pointer — the CSS mirror of `helpers.ts`'s
`hoverVisible`, which § 07's pre-ship list requires for compact form factors.

## Scope references

- `swe/UI design/redesign 0.1.0/Redesign Handoff Spec.dc.html` § 03 (band, header contents, the
  `.workspaceHeader` reference CSS block), § 02 (token mapping), § 07 (DO NOT: no unicode/emoji
  glyphs — `Icon` + lucide; don't hand-roll a dot; no new scale keys)
- `swe/features/app-navigation-screens.md` § Global navigation shell (§ Sidebar content)
- `packages/web-client/src/features/sessions/WorkspaceGroupHeader.tsx` — rewrite
- `packages/web-client/src/features/sessions/SessionList.module.css:69-126` — `.workspaceGroup`,
  `.workspaceHeader*`, `.workspaceChevron`, `.workspaceIcon`, `.workspaceLabel`,
  `.workspaceCount`, `.workspaceMenuBtn`
- `packages/web-client/src/features/sessions/SessionList.tsx:86-115` — group render, props
- `packages/web-client/src/features/sessions/session-presentation.ts` — `workspaceAttentionDot`
  (task-001)
- `packages/web-client/src/components/primitives/Avatar.tsx`,
  `components/primitives/Icon.tsx`, `components/primitives/StatusDot.tsx`,
  `components/primitives/IconButton.tsx:24-29` (`hoverBase`)
- `packages/web-client/src/features/workspace/TabStrip.module.css:73-97` — the reserved-box +
  compact-visibility pattern to mirror
- `packages/web-client/src/features/sessions/workspace-grouping.ts:48-52` — `workspaceLabel`

## What to build

1. **Band CSS** (`SessionList.module.css`): `.workspaceHeader` → `display:flex`,
   `gap: var(--pi-spacing-8)`, `padding: var(--pi-spacing-8) var(--pi-spacing-12)`,
   `background: var(--pi-color-surface2)`, `border-top`/`border-bottom`
   `var(--pi-border-width-1) solid var(--pi-color-border)`, no radius, no side margin. Delete
   `.workspaceGroup`'s `border-bottom` (the band's own borders replace it; keep the class only if
   it still earns its keep as a grouping element). Hover lift applies in **both** states —
   `color-mix(in srgb, var(--pi-color-surface2) 85%, var(--pi-color-foreground) 15%)` on
   `.workspaceHeader:hover`. Deliberate deviation from § 03's `/* collapsed only */` reference
   comment: the band is clickable (collapse-toggling) expanded or collapsed alike, so suppressing
   the affordance on an expanded band would hide a real action — and one rule beats a conditional
   class.
2. **Chevron tile**: one lucide `ChevronRight` through `Icon` at `icon-size-xs` on the existing
   `IconButton` (its native 20px box, filled `surface3` at `--pi-radius-base` — deliberate
   deviation from the mock's 16px tile: forcing 16px means fighting the primitive's sizing for no
   legibility gain), `transform: rotate(90deg)` when expanded — replacing the
   `ChevronDown`/`ChevronRight` swap. The rotation is **instant** — no `transition`, so there is
   nothing for `prefers-reduced-motion` to suppress and no media block is needed. Keep it an
   `IconButton` for the keyboard/aria affordance (`aria-label` "Expand/Collapse workspace") and
   keep the tile's fill static on hover so the band's own lift stays the single affordance.
3. **Avatar**: `Avatar` primitive at `size={20}` with `projectKey={label}`
   (`workspaceLabel(cwd)`), replacing `FolderClosed`. Radius comes from the primitive.
4. **Label**: `flex: 1 1 auto`, ellipsis, `white-space: nowrap`,
   `font-weight: var(--pi-font-weight-bold)`, `--pi-font-size-xs` rung; `title={cwd}` stays on the
   band so the full path is still discoverable.
5. **Attention dot**: `<StatusDot>` from `workspaceAttentionDot(group.sessions)`, rendered **only
   when collapsed** — pass the group's sessions down as a new prop (or the precomputed
   `StatusDotInput | null`; prefer passing the computed value so the header stays presentational,
   matching `SessionItem`'s existing contract where `SessionList` owns the data decisions).
6. **Count pill**: `surface3`, `--pi-radius-full`, `--pi-font-size-4xs`,
   `padding: var(--pi-spacing-1) var(--pi-spacing-6)`, `foregroundMuted`.
7. **`⋮`**: `IconButton size="xs"` with `hoverBase="var(--pi-color-surface2)"` (its ambient
   background changed with the band), glyph through `Icon` (`MoreVertical`, `icon-size-sm`),
   reserved box + `opacity` gating + the `@media (max-width: 575px), (hover: none)` override.
   Behavior (`stopPropagation`, `getBoundingClientRect` anchoring) unchanged.

Frozen behavior: click-anywhere-toggles-collapse, chevron toggles, `title={cwd}`, the
`WorkspaceContextMenu` anchor coordinates, and `ui-store`'s `collapsedWorkspaces` contract.

## Out of scope

- Session rows and their states (task-003).
- Sidebar header/footer, "New session" row (task-004).
- Removing the `surfaceWorkspace` theme key; doc/comment sync (task-005).

## Acceptance criteria

- [ ] The band is edge-to-edge: no side margin, no radius, no card border; `surface2` fill with 1px
      top and bottom `border` tokens, expanded and collapsed alike.
- [ ] Contents render in § 03's order: chevron tile · 20px avatar · bold ellipsised name · dot (only
      when collapsed and a child failed) · count pill · `⋮`.
- [ ] Chevron is a single glyph rotated 90° when expanded; no glyph swap; the rotation is instant
      (no `transition`, no `prefers-reduced-motion` block).
- [ ] Hover lift appears on both expanded and collapsed bands.
- [ ] A 60-char workspace name ellipsises with no wrap and no layout shift; the `⋮` box is reserved
      so hovering never moves the label's truncation point.
- [ ] Below 575px (or coarse pointer) the `⋮` is visible without hover.
- [ ] `surfaceWorkspace` no longer appears in `SessionList.module.css`; no `var(--pi-…)` reference
      in the file is unresolvable.
- [ ] Collapse/expand, the context menu, and `collapsedWorkspaces` seeding behave exactly as before.

## Test / verification plan

- Build: `npm run build:web-client` succeeds.
- Theme guards: `npx vitest run packages/web-client/src/theme/token-integrity.test.ts
  packages/web-client/src/theme/font-scale.test.ts` — pass.
- Format: `npx oxfmt <changed files>`.
- Manual (browser, connected daemon, ≥ 2 workspaces): expanded and collapsed bands look identical
  apart from the chevron; a workspace holding a failed session shows the dot **only** while
  collapsed; hovering a band (expanded or collapsed) lifts it; a long name ellipsises; the `⋮`
  menu opens at the button and both of its actions still work.

## Notes

- `Avatar` renders a **single** initial (`ui/avatar.ts` `avatarInitial`), where § 03's mock shows a
  two-letter "AZ" and a brand "π". Deliberate deviation — § 07 forbids hand-rolling a primitive
  that exists, and a brand mark belongs to `BrandLogo`/white-label, not the workspace tree. Record
  it in the task summary.
- `Avatar`'s fallback palette is raw hex (`ui/avatar.ts:6-19`), theme-invariant by design and
  pre-existing; do not "fix" it into tokens here.
- Three more recorded deviations from § 03, all decided at planning time to keep the CSS state
  matrix small: the chevron tile is the `IconButton`'s native 20px (mock: 16px), its rotation is
  instant (mock implies a transition; none is shipped, so no reduced-motion guard exists), and the
  band's hover lift applies in both states (§ 03's reference comment says collapsed-only, but the
  band is clickable in both). Record all three in the task summary.
- § 03's "The icon rail is removed" is a reference-app statement: this client never had an icon
  rail (`routes/WorkspacePage.tsx` is a plain 3-column shell). Nothing to remove.
