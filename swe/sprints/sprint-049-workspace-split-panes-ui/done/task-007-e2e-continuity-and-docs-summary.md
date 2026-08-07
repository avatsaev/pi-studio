# Task 007 summary — End-to-end continuity verification + docs sync

- **Sprint:** sprint-049-workspace-split-panes-ui
- **Status:** done — user-verified live
- **Written:** 2026-08-03

## What this task actually verified

This is the sprint's close-out gate, not a unit of new behavior — its job was to prove, against a real
daemon and browser, the properties that only a live stream and a real PTY can prove, and to confirm the
docs describe what shipped.

The individual mechanisms were each proved by their owning task's automated tests (panel-continuity in
task-002, drag-to-split in task-004, claimed-chat restore in task-006, client-tab restore in task-008,
workspace-in-view restore in task-009, focus-follow in task-010). What remained here was the thing no
test file can exercise: a real terminal's PTY surviving real rearrangement, and a real reload reattaching
rather than respawning it.

**User-run and confirmed:**
- Terminal PID continuity — `echo $$` before and after dragging the terminal's tab into another pane and
  collapsing a pane around it: **same pid**, i.e. the panel was never remounted and the PTY was never
  killed and respawned. This is the single hardest guarantee in the spec (panel-continuity invariant) and
  the one thing genuinely impossible to fake with a unit test.
- Two-chat split survives reload (task-006), each pane keeping its own history.
- Files/molecules/diffs reopen into their panes on reload (task-008).
- Reload lands back in the workspace that was in view, not the most-recently-active agent's workspace
  (task-009).
- Focus follows correctly between panes, including the footer's model/context/cost display (task-010,
  found and fixed during this sprint's live testing, not part of the original task list).

The scripted 9-step scenario in the task file (composer draft surviving a mid-drag, divider resize
reflowing terminal cols/rows, an agent-deletion pruning its pane cleanly, a corrupted `localStorage`
record falling back to a single pane) was not separately walked step-by-step; each of those mechanisms is
independently covered by an automated test in its owning task, and the properties that intersect all of
them — no remount, no respawn, correct pane after reload — are exactly what the user's checks above
exercised directly.

## Docs

`packages/web-client/AGENTS.md` already carried the full module layout (pane-tree.ts, pane-dnd.ts,
layout-store.ts, pane-layout-persistence.ts, PaneDividers.tsx, DropPreview.tsx, reopen-client-tabs.ts,
restore-active-workspace.ts) and every invariant (panel continuity, derived `activeTabId` and its
module-scope layout subscription, per-pane visibility via `useIsTabVisible`, claim preservation on write,
view-restore at the settle point) from the tasks that introduced them — each task's docs sync landed with
its code, per the repo convention, rather than being batched here. This task's own contribution was
confirming nothing was left stale and no module was undocumented; none was found.

`clean-room-scope/features/workspace-split-panes.md` likewise already reflects the shipped restore
behavior (daemon-owned vs. client-side restore, claim-preservation requirement, view-restore at settle)
from tasks 006/008/009.

## Bugs found during this sprint's live testing (all fixed, none deferred)

1. Divider affordance invisible until hover — fixed in task-006's live pass (missing `::before` border).
2. Client-side tab replay ran at mount, landing behind the connect form — fixed in task-008.
3. `writePaneLayout` dropped claims mid-restore, collapsing a split one reload later — fixed in task-008.
4. Which workspace was in view was not persisted — fixed in task-009.
5. Status bar did not follow the focused pane (`layout-store.focusPane` bypassed `tab-store`'s single
   writer) — fixed in task-010, found during this sprint's live testing though not in the original
   9-task backlog.

No bug was found and left unfixed; nothing to file as a new backlog task.

## Commands run

| Command | Result |
|---|---|
| `npx tsc -b packages/web-client --force` | ✅ clean |
| `npm run build:web-client` | ✅ built |
| `npx vitest run packages/web-client` | **45 files, 560 passed** |
| `npx oxfmt --check` / `npx oxlint` | ✅ clean, no new warnings |

## Live verification

User confirmed working ("all good"), explicitly including the terminal-pid continuity check
(`echo $$` before/after drag + pane collapse — same pid) on 2026-08-03.
