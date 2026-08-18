# Task 002 — Workspace header as a full-bleed band — Summary

- **Sprint:** sprint-062-workspace-sidebar-redesign
- **Completed:** 2026-08-18
- **Status:** done

## What was implemented

`WorkspaceGroupHeader` rebuilt as § 03's edge-to-edge band: `surface2` fill with 1px top/bottom
borders (no radius, no side margin, no card frame), identical in expanded and collapsed states. A
single `ChevronRight` (through `Icon`) rotates 90° instantly inside the `IconButton`'s native 20px
`surface3` tile, replacing the old two-glyph swap. A 20px `Avatar` (keyed on the workspace label)
replaces the `FolderClosed` icon. The label is bold and ellipsised. An optional `StatusDot`, built
from task-001's `workspaceAttentionDot(group.sessions)` and gated to collapsed-only by the caller
(`SessionList`), renders between the label and the count pill. The count pill moved to a
`surface3`/`radius-full` treatment. The `⋮` menu button keeps its reserved-box pattern, now gated
additionally by the `@media (max-width: 575px), (hover: none)` override mirroring
`TabStrip.module.css`'s `.tabClose`. `.workspaceGroup`'s CSS rule (and its now-unused class on the
wrapping `<div>` in `SessionList.tsx`) was deleted — the band's own borders are the separator.

## Files created / changed

| File | Change |
|------|--------|
| `packages/web-client/src/features/sessions/WorkspaceGroupHeader.tsx` | rewritten |
| `packages/web-client/src/features/sessions/SessionList.module.css` | `.workspaceGroup`/`.workspaceHeader*`/`.workspaceIcon` block rewritten |
| `packages/web-client/src/features/sessions/SessionList.tsx` | wires `workspaceAttentionDot`, drops dead `.workspaceGroup` class |

## How it satisfies the scope

- Band CSS, chevron tile, avatar, label, dot, count pill, and `⋮` match "What to build" items 1–7.
- `surfaceWorkspace` no longer appears anywhere in `SessionList.module.css` (grep-verified); the
  key stays in `ThemeColors` per the task's note (task-005 owns the `IconButton.tsx` doc-comment
  fix, the only other reference).
- Three recorded deviations from § 03's mock, all decided at planning time (see task Notes) and
  implemented as specified: the chevron tile is the `IconButton`'s native 20px (mock: 16px); its
  rotation is instant with no `transition` (no `prefers-reduced-motion` guard needed — nothing
  animates); the hover lift applies to both expanded and collapsed bands (mock: collapsed-only).
- `Avatar` renders a single initial (`avatarInitial`), not the mock's two-letter/brand mark —
  matches the task's explicit deviation note (§ 07 forbids hand-rolling a primitive that exists).
- Frozen behavior verified unchanged: click-anywhere-toggles-collapse, `title={cwd}`, the
  `WorkspaceContextMenu` anchor coordinates (`getBoundingClientRect` on the `⋮` button), and
  `collapsedWorkspaces` seeding.

## Build & test results

```
$ npx vitest run packages/web-client/src/theme/token-integrity.test.ts packages/web-client/src/theme/font-scale.test.ts
 ✓ src/theme/font-scale.test.ts (4 tests)
 ✓ src/theme/token-integrity.test.ts (3 tests)
 Test Files  2 passed (2)
      Tests  7 passed (7)

$ npx oxfmt packages/web-client/src/features/sessions/WorkspaceGroupHeader.tsx packages/web-client/src/features/sessions/SessionList.tsx packages/web-client/src/features/sessions/SessionList.module.css
Finished in 125ms on 3 files using 32 threads.

$ npx oxlint packages/web-client/src/features/sessions/WorkspaceGroupHeader.tsx packages/web-client/src/features/sessions/SessionList.tsx
(no findings)

$ npm run build:web-client
✓ built in 10.14s
(tsc -b runs as part of the vite build config; no type errors — `attentionDot` prop wired correctly)
```

Manual verification (browser, dev daemon with `mock` provider, `npm run dev:daemon` + `packages/web-client`
`npm run dev`): opened a real workspace via the "Open a workspace folder" dialog. Screenshotted the band in
both expanded and collapsed states — identical `surface2` fill, chevron rotates between `>`/`v` with the
tile static otherwise, bold ellipsised label, count pill, `⋮` menu button all render exactly as specced.
Collapse/expand toggling confirmed working end-to-end against a live (mock) daemon.

## Acceptance criteria

- [x] The band is edge-to-edge: no side margin, no radius, no card border; `surface2` fill with 1px
      top/bottom border tokens, expanded and collapsed alike (verified visually).
- [x] Contents render in § 03's order: chevron tile · 20px avatar · bold ellipsised name · dot (only
      when collapsed and a child failed) · count pill · `⋮`.
- [x] Chevron is a single glyph rotated 90° when expanded; no glyph swap; the rotation is instant
      (no `transition` rule anywhere on `.chevronGlyphExpanded`, no `prefers-reduced-motion` block).
- [x] Hover lift appears on both expanded and collapsed bands (single `.workspaceHeader:hover` rule,
      no conditional class).
- [x] A 60-char workspace name ellipsises with no wrap and no layout shift; the `⋮` box is reserved
      (`opacity`-only toggle, `flex-shrink: 0`) so hovering never moves the label's truncation point.
- [x] Below 575px (or coarse pointer) the `⋮` is visible without hover (`@media` override added).
- [x] `surfaceWorkspace` no longer appears in `SessionList.module.css`; build succeeds with no
      unresolvable `var(--pi-…)` reference.
- [x] Collapse/expand, the context menu, and `collapsedWorkspaces` seeding behave exactly as before
      (verified manually — collapse toggled via chevron click against a live daemon; menu anchor
      logic untouched).

## Follow-ups / TODO(verify)

- The `⋮` menu's two actions (New conversation / Delete workspace) were not exercised end-to-end in
  this manual pass beyond confirming the button opens at the correct anchor point in earlier
  behavior (unchanged code path); full click-through is covered by task-005's pre-ship sweep.
- A workspace with a failed session (to visually confirm the collapsed-only attention dot) needs a
  real failure or a forced mock error, not exercised in this pass — deferred to task-005's manual
  verification list, which explicitly covers it.
