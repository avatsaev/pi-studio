# Task 003 — Frameless session rows + selection / activity states

- **Sprint:** sprint-062-workspace-sidebar-redesign
- **Status:** backlog
- **Type:** feature
- **Area:** packages/web-client — features/sessions
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** task-001, task-002

## Goal

Rebuild `SessionItem` as § 03's frameless two-line row — status-only meta, unmistakable selection
fill with a left accent bar, activity expressed by the spinner rather than the fill, and a
destructive tint for a failed turn — preserving click-to-open, the drag payload and the context
menu.

## Context / why

Today's row (`SessionItem.tsx`, `SessionList.module.css:26-66`) is a full-bleed strip with a
`border-bottom: 1px solid transparent`, an always-on `StatusDot showInactive`, a meta line reading
`cwd · agentId · N msgs`, an absolutely-positioned `⋮`, and an active state that is only a
`surface0` fill plus a 2px inset accent shadow. § 03 rewrites every one of those:

> **Session rows are frameless.** No border, no card. Two lines: title row (ellipsis + trailing
> status affordance) and a meta line at `font-size-3xs`. Idle fill is
> `color-mix(in srgb, var(--pi-color-surface0) 60%, transparent)`; hover goes to solid `surface0`.
> Padding is even (`spacing-7`/`spacing-10`) — no left indent.
>
> **Selection is unmistakable:** `color-mix(accent 34%, transparent)` fill, 1px inset ring in
> `color-mix(accentBright 32%, transparent)`, white bold title, and a 2px full-height
> `accentBright` bar on the left edge.
>
> **Running ≠ selected.** A running-but-unselected session keeps the normal fill and gets the
> spinner plus a half-opacity left bar. Selection is fill; activity is the spinner.
>
> **No timestamps, no cost** in the sidebar. The meta line carries status only (plus a short
> failure reason).

Three app-specific points:

**(a) "white bold title" is `accentForeground`, never `#fff`.** § 07's pre-ship list calls this out
by name for the `zinc` variant, whose accent is near-white — a hardcoded white title would vanish.
Same rule sprint-059/task-003 applied to the user bubble.

**(b) The status affordance is `StatusDot`, one primitive for all states.** `StatusDot` already
renders an `accentBright` spinning ring for `{ status: "running" }` and a flat `statusDanger` dot
for `error` (`StatusDot.tsx:31-46`), which is exactly § 03's STATE → TOKEN table; task-001's
`sidebarSessionView().dot` returns `null` for idle/empty so the row renders no dot at all. Nothing
hand-rolled, and the current `showInactive` always-on muted dot goes away.

**(c) The indent goes.** `.workspaceSessions { padding-left: var(--pi-spacing-12) }` is replaced by
§ 03's even container padding (`spacing-5 spacing-8 spacing-8`, `gap: spacing-3`) — the band
already expresses hierarchy, so the extra indent only costs label width.

## Scope references

- `swe/UI design/redesign 0.1.0/Redesign Handoff Spec.dc.html` § 03 (frameless rows, selection,
  running-≠-selected, STATE → TOKEN, the `.sessionRow`/`.sessionRowActive`/`.activeBar`/
  `.sessionMeta` reference CSS block), § 02 (token mapping, `radius-sm`), § 07 (DO NOT: no
  hand-rolled dot/spinner; `accentForeground` on accent fills; no per-session cost or timestamp)
- `swe/features/app-navigation-screens.md` § Global navigation shell (§ Sidebar content)
- `swe/features/workspace-split-panes.md` § Drag sources — the sidebar row as a pane drop source
- `packages/web-client/src/features/sessions/SessionItem.tsx` — rewrite
- `packages/web-client/src/features/sessions/SessionList.module.css:26-66,125-128` — `.item`,
  `.title`, `.meta`, `.menuBtn`, `.workspaceSessions`
- `packages/web-client/src/features/sessions/SessionList.tsx:43-62,96-110` — `handleSelect`,
  `handleDragStart`, row props
- `packages/web-client/src/features/sessions/session-presentation.ts` (task-001)
- `packages/web-client/src/components/primitives/StatusDot.tsx`,
  `components/primitives/Icon.tsx`, `components/primitives/IconButton.tsx`
- `packages/web-client/src/features/workspace/TabStrip.module.css:74-96` — reserved-box pattern

## What to build

1. **Row shape** (`SessionItem.tsx`): two lines. Title row = label span (`flex: 1`, ellipsis,
   nowrap) + `StatusDot` from `sidebarSessionView().dot` + the reserved `⋮`. Meta row =
   `view.meta`, plus `· <view.reason>` as a second segment when present (separator muted, reason
   ellipsised). `view.titleItalic` renders the title italic. Delete the `cwd`/`agentId`/
   `userMessageCount` meta entirely.
2. **Row CSS**: `position: relative`, `padding: var(--pi-spacing-7) var(--pi-spacing-10)`,
   `border-radius: var(--pi-radius-sm)`, `background: color-mix(in srgb, var(--pi-color-surface0)
   60%, transparent)`, no border. `:hover` → solid `var(--pi-color-surface0)`.
   `.meta` → `--pi-font-size-3xs`, `foregroundMuted`.
3. **Selected**: `color-mix(in srgb, var(--pi-color-accent) 34%, transparent)` fill,
   `box-shadow: inset 0 0 0 var(--pi-border-width-1) color-mix(in srgb,
   var(--pi-color-accentBright) 32%, transparent)`, `color: var(--pi-color-accentForeground)` +
   `font-weight: var(--pi-font-weight-bold)` on the title, and a 2px full-height `accentBright`
   left bar (`::before` or an `.activeBar` span — § 03 allows either).
4. **Running, not selected**: normal fill, `StatusDot`'s ring, plus the same left bar at
   `color-mix(in srgb, var(--pi-color-accentBright) 45%, transparent)`. Selection must remain
   readable as *fill*, activity as *ring*.
5. **Failed**: row tint `color-mix(in srgb, var(--pi-color-destructive) 10%, transparent)`
   (loses to the selected fill when both apply), meta label in `--pi-color-destructive`, reason in
   `foregroundMuted`.
6. **Empty**: italic title, meta `no messages` at `opacity: var(--pi-opacity-50)`.
7. **`⋮`**: same treatment as task-002's band button — in flow at the end of the title row (not
   absolutely positioned), reserved box, `opacity`-gated on `:hover`/`:focus-within`, always
   visible under `575px`/coarse pointer, `hoverBase="var(--pi-color-surfaceSidebar)"`, glyph via
   `Icon`. Anchoring behavior unchanged.
8. **Container**: `.workspaceSessions` → `padding: var(--pi-spacing-5) var(--pi-spacing-8)
   var(--pi-spacing-8)`, `display: flex`, `flex-direction: column`,
   `gap: var(--pi-spacing-3)`; drop `padding-left`.

Frozen behavior: `onClick` → `activate` + `setCwd` + `openChatTab`; `draggable` decided by
`SessionList` (only the workspace in view, per `handleDragStart`'s comment and
`workspace-split-panes.md` § Drag sources); `onContextMenu` → `SessionContextMenu`.

## Out of scope

- Sidebar header, footer, per-workspace "New session" row (task-004).
- Any change to `SessionList`'s store subscriptions, `openChatTab`, or the drag MIME contract.
- Session rename/delete flows and their menus.

## Acceptance criteria

- [ ] Rows are frameless (no border), `radius-sm`, evenly padded, with no left indent; the meta line
      shows status only — no cwd, no agent id, no message count, no timestamp, no cost.
- [ ] Idle fill is the 60% `surface0` mix; hover is solid `surface0`.
- [ ] The selected row shows all four selection signals (fill, inset ring, `accentForeground` bold
      title, 2px `accentBright` left bar) and no hardcoded white.
- [ ] A running, unselected row keeps the idle fill, shows the spinning ring, and shows a
      half-opacity left bar; it is never mistaken for the selected row.
- [ ] A failed row shows the destructive tint, `turn failed`, and the short reason when one exists;
      the reason ellipsises instead of wrapping.
- [ ] A never-used session renders an italic title and `no messages` at `opacity-50`.
- [ ] The `⋮` box is reserved (no truncation shift on hover) and is visible without hover below
      575px / on a coarse pointer.
- [ ] Dragging a row from the workspace in view still splits a pane; a row from another workspace
      still produces no drop target.

## Test / verification plan

- Build: `npm run build:web-client` succeeds.
- Tests: `npx vitest run packages/web-client/src/features/sessions` — task-001's suite still
  passes; no new test infrastructure (components stay thin, per project convention).
- Theme guards: `npx vitest run packages/web-client/src/theme/token-integrity.test.ts
  packages/web-client/src/theme/font-scale.test.ts` — pass.
- Format: `npx oxfmt <changed files>`.
- Manual (browser): drive a real session through idle → running → completed and a failing turn
  (e.g. disconnect the model provider) to see running/failed/idle live; create a fresh chat for the
  empty state; select a different session while one runs, to confirm fill-vs-ring; drag a row into
  a pane; right-click a row.

## Notes

- On the selected row the ring is `accentBright` on a 34% accent fill (`StatusDot` hardcodes
  `accentBright` for the running ring), not § 03's mock white-on-accent. Acceptable and
  intentional — one primitive over a bespoke variant; note it in the summary.
- `SessionList` already subscribes to the whole `sessions` record, so every stream event re-renders
  every row. Do not add a per-row store subscription; keep `SessionItem` presentational and call
  `sidebarSessionView(session)` in the row body.
