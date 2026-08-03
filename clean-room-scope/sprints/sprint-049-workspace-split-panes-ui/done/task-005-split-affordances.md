# Task 005 — Split affordances: Split right / Split down, per-pane new-tab targeting

- **Sprint:** sprint-049-workspace-split-panes-ui
- **Status:** in_progress
- **Type:** feature
- **Area:** web-client / workspace
- **Priority:** P2
- **Estimated size:** S
- **Depends on:** task-004

## Goal
Programmatic split entry points: Split right / Split down actions on the focused pane that seed a
new chat in the new pane, disabled (never degraded) when `canSplit` is false.

## Context / why
Drag is the primary gesture, but the spec (§ Programmatic splits) defines button entry points with
a different failure mode: an affordance that cannot apply is **disabled** — a button that silently
does something other than its label is worse than one that is greyed out.

Split-empty seeds a fresh tab because an empty pane cannot exist at rest (the assignment invariant:
a pane with no tabs collapses). In this client the seeded tab is a **new chat**
(`openNewChat` — the closest thing to `workspace-ui.md`'s draft tab; it opens a draft-state chat
with an eagerly materialized session).

## Scope references
- `clean-room-scope/features/workspace-split-panes.md` § Programmatic splits,
  § Error Handling & Edge Cases (programmatic row)
- Modify: `packages/web-client/src/features/workspace/TabStrip.tsx` (trailing actions cluster,
  `NewTabMenu` region)
- Modify: `packages/web-client/src/stores/tab-store.ts` (open helpers accept an optional target
  pane, threaded to `layout-store.assignTab`)
- Reference: `packages/web-client/src/hooks/use-shortcuts.ts` (shortcut registration pattern)

## What to build
- **Trailing actions**: add Split right / Split down icon buttons next to the "+" menu in each
  pane's strip (or as entries in `NewTabMenu` if the strip is width-constrained — pick one,
  justify in the summary). Action: `layout-store.splitEmpty(cwd, paneId, "right" | "bottom")` →
  on a pane id, `openNewChat(workspaceCwd)` targeted at that pane.
- **Disabled state**: button disabled with a tooltip ("Maximum split depth reached") when
  `canSplit` is false for that region; never silently degrade.
- **Targeted opens**: `openNewChat` / `openNewTerminal` / `openNewMolecule` gain an optional
  `targetPaneId` parameter (default: focused pane — current behaviour), passed through
  `tab-store.open` → `layout-store.assignTab`. Each pane's "+" menu passes its own pane id
  (task-003 wired the menu per pane; this makes the targeting explicit rather than relying on
  focus timing).
- **Shortcuts**: none added by default (`keyboard-shortcuts.md` scope); ensure existing
  `Ctrl/Cmd+T` opens in the focused pane (it already will via the default).

## Out of scope
- Pane-focus-cycling shortcuts, move-tab-to-pane shortcuts (future keyboard-shortcuts work).
- Mobile/compact form factor (no splits there).

## Acceptance criteria
- [ ] Split right on the focused pane creates a right-hand pane containing a fresh chat tab, active
      and focused; Split down mirrors vertically.
- [ ] Repeated Split right produces one flat row run (assert via store state, not pixels).
- [ ] At a state where `canSplit("right")` is false, the Split right button is disabled with the
      tooltip; Split down (if legal) stays enabled — per-region evaluation.
- [ ] The "+" menu of a non-focused pane opens the new tab in *that* pane and focuses it.
- [ ] `Ctrl/Cmd+T` still opens a terminal in the focused pane.
- [ ] Single pane: the new buttons are the only visible chrome change; everything else identical.

## Test / verification plan
- Tests: store-level tests for targeted opens (`tab-store` + `layout-store` interplay); the
  disabled-state predicate is `canSplit` (already covered) — component test only if the existing
  setup supports it cheaply. Run `npx vitest run packages/web-client/src/stores/`.
- Build: `npm run build:web-client` succeeds.
- Typecheck: `npm run typecheck` succeeds.
- Manual: exercise both buttons to depth 4, verify disabled states and flat runs.

## Notes
- Seeding a chat (not a bare "empty pane") is what keeps `splitEmpty` + assignment atomic from the
  user's perspective; if the seeded chat's session creation fails offline, the tab still exists
  (existing `openNewChat` best-effort contract, `tab-store.ts:271–288`).
