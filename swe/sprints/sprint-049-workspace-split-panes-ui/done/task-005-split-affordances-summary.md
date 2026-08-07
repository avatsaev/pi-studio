# Task 005 summary — Split affordances: Split right / Split down, per-pane new-tab targeting

- **Sprint:** sprint-049-workspace-split-panes-ui
- **Status:** done
- **Completed:** 2026-08-03

## What was built

- **Targeted opens.** `tab-store.open(tab, targetPaneId?)` threads the target to
  `layout-store.claimPaneFor`, and `openNewChat` / `openNewTerminal` / `openNewMolecule` all take an
  optional `targetPaneId`. Omitted (the `Ctrl/Cmd+T` shortcut, the sidebar's "+ New conversation",
  `open-workspace.ts`) it still means "the focused pane" — unchanged behaviour.
- **Each pane's "+" menu now passes its own pane id** instead of focusing the pane first and relying
  on the open helper picking up that focus. The old ordering worked but was a race waiting to happen;
  the target is explicit now.
- **`SplitActions`** in every strip: Split right (`Columns2`) and Split down (`Rows2`).
  `splitEmpty(cwd, paneId, region)` then `openNewChat(cwd, created)` — one action, because a pane with
  no tabs cannot exist at rest, and `openNewChat` opens synchronously even offline (its server-side
  record is best-effort), so the new pane is never briefly empty.
- **Disabled, never degraded.** Each button's `disabled` and its `title` come from
  `canSplit(tree, paneId, region)` — per region, so Split right can be live while Split down is
  disabled with "Maximum split depth reached". This is the deliberate difference from a drag, which
  degrades to a move instead.

**Placement choice (the task asked for a justification):** icon buttons in the strip, not entries in
the "+" menu. The spec's § Programmatic splits describes visible affordances with a disabled state,
and a disabled button with a reason in its tooltip is exactly that. What made this viable in narrow
panes is the layout fix below.

## Fix found by live testing

The first attempt at repeated Split right silently did nothing on the second click. Cause: the whole
strip was one `overflow-x: auto` scroll container, so in a 225px pane the trailing actions sat *past*
the visible area — present in the DOM, unreachable by pointer. The tabs now live in a `.tabs`
scroll container (`flex: 1 1 auto; min-width: 0`) and the actions are non-shrinking siblings outside
it, pinned to the strip's right edge. Verified across pane widths 450/225/113px: every action's rect
is inside its strip's box, and clicks land at 113px **and 56px**.

## Files changed

| File | Change |
|---|---|
| `stores/tab-store.ts` | `open(tab, targetPaneId?)`; the three `openNew*` helpers take a target pane |
| `features/workspace/TabStrip.tsx` | `SplitActions`; "+" menu targets its own pane; tabs wrapped in a scroll container |
| `features/workspace/TabStrip.module.css` | `.tabs` scroll container, `.splitAction`, `.strip { overflow: hidden }` |
| `stores/tab-store.test.ts` | +6 tests (29 in the file) |

## Commands run

| Command | Result |
|---|---|
| `npx vitest run packages/web-client/src/stores/tab-store.test.ts` | **29 passed** |
| `npx vitest run packages/web-client` | **43 files, 528 passed** |
| `npm run build:web-client` | ✅ built in 7.62s |
| `npx oxlint` (workspace + stores) | ✅ no new warnings (1 pre-existing in `session-store.ts`) |
| `npx oxfmt` (34 files) | ✅ formatted |

## Live verification (headless Chromium, real clicks and keystrokes)

| Action | Observed |
|---|---|
| single pane, chrome | strip shows `New tab`, `Split right`, `Split down`; both enabled |
| **Split right** | `row` split, right pane seeded with a fresh "New chat", focused, `activeTabId` = the new tab |
| Split down → Split right (depth 4, `row` run) | focused pane's buttons: **Split right enabled**, **Split down disabled with `title="Maximum split depth reached"`** — per-region, no degradation |
| Split right ×2 on that depth-4 pane | its inner `row` went 3 → 5 children, **all leaves**, one flat run; no nesting, 7 panes total |
| `Ctrl+T` | terminal opened in the **focused** pane (`placement[term] === focusedPaneId`), active there |
| a non-focused pane's "+" → New molecule | opened in **that** pane and focused it |
| narrow panes (450 / 225 / 113 px) | every trailing action's rect inside its strip; clicks land |

## Acceptance criteria

- [x] Split right creates a right-hand pane containing a fresh chat, active and focused; Split down
      mirrors vertically (same code path, `region` only).
- [x] Repeated Split right produces one flat row run — asserted on store state both in a unit test
      (4 leaf children, `direction: "row"`) and live (3 → 5 leaves, all leaves).
- [x] At the depth cap the perpendicular button is disabled with the tooltip while the same-direction
      one stays enabled; a refused `splitEmpty` returns `null` and leaves the layout object identical.
- [x] A non-focused pane's "+" opens in that pane and focuses it.
- [x] `Ctrl/Cmd+T` still opens a terminal in the focused pane.
- [x] Single pane: the two new buttons are the only chrome change — the strip's height/position and the
      panel box are unchanged (`220,51 900x33` strip, measured again this task).

## Notes / follow-ups

- Splits halve the target pane, so five splits inside a 225px pane produce 28px panes. That is the
  spec's own "a pane can be born below `MIN_PANE_FRACTION`; a divider drag can then only grow it"
  case, not a defect — no clamp applies to split-created sizes by design.
- No shortcuts were added, per the task (`keyboard-shortcuts.md` owns that surface).
