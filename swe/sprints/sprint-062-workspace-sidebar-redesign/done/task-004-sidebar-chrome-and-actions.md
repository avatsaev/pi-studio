# Task 004 — Sidebar chrome: counted header, per-workspace "New session", pinned footer

- **Sprint:** sprint-062-workspace-sidebar-redesign
- **Status:** done
- **Type:** feature
- **Area:** packages/web-client — features/sessions
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** task-002, task-003

## Goal

Finish § 03's sidebar frame: a `WORKSPACES · N` header sized to the pane band, a trailing
`＋ New session` row inside each expanded workspace, and one pinned `＋ Add workspace` footer row —
with exactly one open-workspace affordance in the whole sidebar.

## Context / why

§ 03's mock has three pieces of chrome the current sidebar lacks or duplicates:

| § 03 mock | Today |
|---|---|
| `WORKSPACES · 2` header, `11px`/bold/`.1em`, with a `＋` | `Workspaces` (`xs`, 600, `.04em`) + a `FolderOpen` ghost `Button` (`size="xs" variant="ghost" iconOnly`, `SessionList.tsx:66-79`) |
| A `＋ New session` row at the end of each workspace's rows | "New conversation" only inside the band's `⋮` menu |
| A footer row: `＋ Add workspace` … `⚙` | nothing |

Decisions this app forces:

**(a) One affordance for "open a workspace", not two — in the sidebar.** The mock shows both a
header `＋` and a footer `＋ Add workspace`; both would call the same `openCwdPicker()`. Ship the
**labeled footer row** (discoverable — the sidebar's only entry point to `OpenWorkspaceDialog`;
`TabPanelHost.tsx:152-156`'s no-workspace empty state keeps its own "Open Workspace" button, which
is a different surface and stays) and leave the header as pure information (`WORKSPACES · N`).
Pinned outside the scroll container so it stays reachable with many workspaces.

**(b) The `⚙` is omitted, not faked.** In the reference app that gear is the sidebar footer's
Settings route (`features/app-navigation-screens.md` § Global navigation shell: "footer icon buttons
(Add project, Home, Settings, host switcher)"). This client has **no settings surface at all** — no
`/settings` route, no appearance dialog; `Toolbar.tsx` carries brand, connection fields and the two
sidebar toggles, and `theme/appearance-store.ts` has no UI. Rendering a gear that opens nothing, or
inventing a settings screen inside a restyle sprint, are both wrong; task 005 records it as
unimplemented against the scope doc.

**(c) The header keeps its 36px band height.** `WORKSPACE_SECONDARY_HEADER_HEIGHT = 36`
(`platform/breakpoints.ts:41`) is the pane tab strip's height as of sprint-061, and the sidebar
header sitting flush with it is an existing product decision. § 03's own padding (`12px 12px 8px`
around an 11px line) lands at ~34px, so honoring the constant is a 2px reconciliation, not a
redesign — declare the height explicitly rather than letting padding decide it.

## Scope references

- `swe/UI design/redesign 0.1.0/Redesign Handoff Spec.dc.html` § 03 (header band, `＋ New session`
  row, footer row), § 02 (token mapping: `4xs`/`3xs`/`2xs` rungs), § 07 (DO NOT: no unicode/emoji
  glyphs — `Icon` + lucide; don't invent state or surfaces)
- `swe/features/app-navigation-screens.md` § Global navigation shell (§ Sidebar content — footer
  icon buttons, the `⚙` origin)
- `packages/web-client/src/features/sessions/SessionList.tsx:63-118` — header, list, groups
- `packages/web-client/src/features/sessions/SessionList.module.css:1-25` — `.header`, `.openBtn`,
  `.list`
- `packages/web-client/src/platform/breakpoints.ts:41` — `WORKSPACE_SECONDARY_HEADER_HEIGHT`
- `packages/web-client/src/stores/tab-store.ts` — `openNewChat(cwd)` (the "New conversation"
  dispatch `WorkspaceContextMenu.tsx:51-54` already uses)
- `packages/web-client/src/stores/ui-store.ts` — `openCwdPicker`
- `packages/web-client/src/features/workspace-picker/OpenWorkspaceDialog.tsx` — the picker
- `packages/web-client/src/components/primitives/EmptyState.tsx`,
  `components/primitives/Panel.tsx`, `components/primitives/Icon.tsx`,
  `components/primitives/Button.tsx`

## What to build

1. **Header** (`SessionList.tsx` + `.header`): text `WORKSPACES · {groups.length}` at
   `--pi-font-size-3xs`, `font-weight-bold`, `letter-spacing: 0.1em`, `foregroundMuted`, uppercase;
   `min-height` pinned to 36px via the same `WORKSPACE_SECONDARY_HEADER_HEIGHT` value the strip uses
   (a local CSS custom property or an inline `min-height` from the constant — do **not** invent a
   `--pi-*` name; `token-integrity.test.ts` fails any `var(--pi-…)` the theme does not emit).
   Remove the `FolderOpen` ghost `Button` and `.openBtn`. Delete the header's `border-bottom` —
   the first band's own top border is the separator (§ 03 implies exactly this; decided at
   planning time, no browser A/B needed). With zero workspaces there is no band, so the header
   sits borderless above the empty-state hint — fine, the hint has its own padding.
2. **`＋ New session` row**: last child of each expanded workspace's row container — full-row,
   centered, `--pi-font-size-2xs`, `foregroundMuted`, `radius-sm`, `spacing-6`/`spacing-10` padding,
   hover lift to `surface0`, lucide `Plus` through `Icon` at `icon-size-xs`. Dispatches
   `openNewChat(group.cwd)` — the exact dispatch the band's `⋮` "New conversation" already uses, so
   the menu item stays as-is (keyboard/right-click parity). Disabled with an explanatory `title`
   when `status !== "open"`.
3. **Footer**: a pinned row after `.list` (so it is outside the scroll container),
   `border-top` 1px `border`, `--pi-font-size-2xs`, `foregroundMuted`, hover lift; lucide `Plus` +
   label `Add workspace`; `onClick` → `openCwdPicker()`; disabled + `title` when
   `status !== "open"`, preserving today's gating copy ("Connect to open a workspace" /
   "Open a workspace folder"). No `⚙`.
4. **Empty state**: keep `EmptyState`'s existing "Not connected" / "No workspaces — open a folder to
   start" copy (documented in `packages/web-client/AGENTS.md:560-562`); with the footer now always
   visible, the hint and its action read as one unit — confirm the two don't restate each other
   confusingly and adjust only the hint's padding if needed.
5. Pass the collapsed-band attention input from task-001's `workspaceAttentionDot(group.sessions)`
   here, in `SessionList` (the data owner), not inside the header component.

## Out of scope

- A settings surface, route, or dialog of any kind (the `⚙`).
- Session/workspace rename or delete flows; the two context menus keep their current items.
- `Toolbar` changes; sidebar width/resize behavior; `collapsedWorkspaces` seeding.

## Acceptance criteria

- [ ] The header reads `WORKSPACES · N` with `N` = number of workspace groups, at the `3xs` rung,
      bold, `.1em` tracking, and its band is 36px tall — flush with a pane's tab strip.
- [ ] Exactly one "open a workspace" affordance exists in the sidebar (the footer row); the header's
      icon button is gone.
- [ ] The footer stays visible (does not scroll away) with enough workspaces to overflow the list,
      and is disabled with the connect hint while disconnected.
- [ ] Each expanded workspace ends with a `＋ New session` row that opens a new chat in that
      workspace's cwd; it is disabled while disconnected; the band's `⋮` "New conversation" still
      works and produces the identical result.
- [ ] No unicode `＋`/`⚙`/`▶` glyph is rendered as an icon anywhere in the sidebar — every glyph is
      `Icon` + lucide.
- [ ] The disconnected and no-workspaces empty states still render their existing copy.

## Test / verification plan

- Build: `npm run build:web-client` succeeds.
- Theme guards: `npx vitest run packages/web-client/src/theme/token-integrity.test.ts
  packages/web-client/src/theme/font-scale.test.ts` — pass.
- Tests: `npx vitest run packages/web-client/src/features/sessions` — passes (no new suite; this
  task is markup/CSS plus two existing dispatches).
- Format: `npx oxfmt <changed files>`.
- Manual (browser): disconnected → header reads `WORKSPACES · 0`, footer disabled with the hint;
  connected with 2+ workspaces → count correct, footer opens `OpenWorkspaceDialog`, `＋ New session`
  opens a chat in the right cwd (check the pane's tab and `StatusBar` cwd), header aligns pixel-wise
  with a pane's 36px tab strip, and the footer stays pinned while the list scrolls.

## Notes

- `openNewChat` already handles tab creation/focus; do not reimplement chat creation here.
- Keep `Panel` as the sidebar's shell — the header/list/footer are `flex-none`/`flex-1`/`flex-none`
  children of it, so no new wrapper element is needed.
