# Implementation Plan — Workspace Split Panes (web-client)

> Derived from `clean-room-scope/features/workspace-split-panes.md` and the existing web-client
> source. Sprints and tasks are in implementation order; execute with `av-swe implement`, one
> sprint at a time.
> **Version:** 1 · **Updated:** 2026-08-03

> **Prior history:** sprints `sprint-001` … `sprint-047` under `clean-room-scope/sprints/` predate
> this PLAN.md and are all complete (every task in `done/` with a summary). This file tracks the
> active effort only; it becomes the single source of truth for new sprints going forward.

## Strategy

Bottom-up, riskiest-invariant-first:

1. **Sprint 048 — pure model layer.** The pane-tree algebra, geometry, validation, the layout
   store, identity-keyed persistence, and order-independent restore are all pure logic, fully
   unit-testable with no UI change. Every subtle spec rule with real bug risk (per-branch depth
   check, flat-run splice on collapse, resize-only minimum, pending-claim pruning guard,
   focus-steal guard) lands here behind tests before any pixel moves. The sprint is inert: nothing
   renders from the new store until sprint 049, so the web client ships identically throughout.
2. **Sprint 049 — UI integration.** Wire the tab store to the layout store (the derived
   `activeTabId` — the riskiest refactor, protected by the existing test suite), then rendering
   (flat host + computed rectangles, the panel-continuity invariant), then chrome (per-pane strips,
   dividers, focus), then the drag gesture (single context, drop regions, degradation preview),
   then programmatic affordances, and finally a live end-to-end continuity verification + docs
   sync as the close-out gate.

Panes are strictly client-side presentation state — no protocol or daemon work anywhere in this
plan. Connect-time restore hooks (`use-session-restore.ts`, `use-terminal-restore.ts`) already
exist and are consumed, not built.

## Sprint overview

| # | Sprint | Goal | Tasks | Status |
|---|--------|------|-------|--------|
| 048 | `sprint-048-workspace-split-panes-model` | Pane-tree algebra, layout store, persistence, restore claims — pure, tested, inert | 6 | **done** (2026-08-03) |
| 049 | `sprint-049-workspace-split-panes-ui` | Rendered splits: strips, dividers, drag-to-split, affordances, restore, live continuity proof | 13 | **done** (2026-08-03) |

Sprint 048 added 123 tests across four files and left the running UI byte-identical — none of its
modules is imported by a rendered component yet. Sprint 049 wired all of it into the rendered UI, fixed
four live-testing bugs (divider affordance, replay timing, claim-dropping on write, workspace-in-view
not persisted) plus one found after the original task list (status bar not following focus, task-010),
and closed with a user-verified live pass including terminal-PTY continuity across pane rearrangement.
A fifth post-close bug (task-011) then surfaced live: two legacy pre-split restore fallbacks — "open
the most recent chat", "reopen every running terminal" — still fired unconditionally and could
silently steal a claim-restored pane's active tab a moment after a correct restore, since neither
knew about claims. Fixed and unit-pinned; awaiting the user's live reload check before re-closing.
Task-012 then added the other way into a split, requested once the feature was in use: dragging a
conversation row or a file row straight out of a sidebar onto a pane. It needed no new layout algebra —
`splitEmpty` + a targeted `open` already composed into it — but it is deliberately **native HTML5 DnD**
rather than dnd-kit, because dnd-kit cannot receive the OS file drops the file tree depends on.
Task-013 closed the third and last of the pre-split restore leftovers: the sidebar's expanded group, the
file-explorer root and the active conversation were all still seeded from the globally most-recently-
active agent, so with two workspaces open the panes restored into one while the sidebar sat expanded on
another — the "my layout was lost" symptom, from the one surface task-009 had not covered.
Full web-client suite after it: **596 passing** (47 files).

## Task index

### sprint-048-workspace-split-panes-model

| Task | Title | Type | Area | Depends on | Covers (specs + source) |
|------|-------|------|------|-----------|------------------------|
| task-001 | pane-tree core: model, canSplit, splitPane, removePane | feature | workspace | none | workspace-split-panes.md § Pane tree/Splitting/Removing · `features/workspace/pane-tree.ts` (new) |
| task-002 | pane-tree geometry, dividers, resize, effective tree | feature | workspace | task-001 | § Geometry/Resizing · `pane-tree.ts` |
| task-003 | parse/validate/renormalize persisted tree | feature | workspace | task-001 | § Data & Persistence/Edge Cases · `pane-tree.ts` |
| task-004 | layout-store: assignment, focus, split ops | feature | stores | task-001, task-002 | § Tab ↔ pane/Programmatic splits · `stores/layout-store.ts` (new) |
| task-005 | tab identity + debounced persistence | feature | stores | task-003, task-004 | § Persisted layout record/Tab identity · `lib/pane-layout-persistence.ts` (new), `stores/tab-store.ts` (read) |
| task-006 | restore claims, settle point, pruning | feature | stores | task-004, task-005 | § Restoring a persisted layout · `layout-store.ts`, `hooks/use-session-restore.ts`, `hooks/use-terminal-restore.ts` |

### sprint-049-workspace-split-panes-ui

| Task | Title | Type | Area | Depends on | Covers (specs + source) |
|------|-------|------|------|-----------|------------------------|
| task-001 | route tab-store lifecycle through layout store | refactor | stores | sprint-048/task-006 | § Tab ↔ pane assignment · `stores/tab-store.ts` |
| task-002 | TabPanelHost: flat host + computed rectangles | feature | workspace | task-001 | § Panel continuity invariant · `features/workspace/TabPanelHost.tsx` |
| task-003 | per-pane strips, dividers, pane focus | feature | workspace | task-002 | § UI Behavior/Resizing · `TabStrip.tsx`, `PaneDividers.tsx` (new), `routes/WorkspacePage.tsx` |
| task-004 | drag-to-split: single context, regions, preview | feature | workspace | task-003 | § Drop regions/Resolving/Splitting · `pane-dnd.ts` (new), `DropPreview.tsx` (new), `TabStrip.tsx` |
| task-005 | split affordances + per-pane new-tab targeting | feature | workspace | task-004 | § Programmatic splits · `TabStrip.tsx`, `stores/tab-store.ts` |
| task-006 | restore claimed chat tabs, agent-stable identity | bugfix | hooks, lib | task-001 | § Restoring a persisted layout, § Tab identity · `hooks/use-session-restore.ts`, `stores/tab-store.ts`, `lib/pane-layout-persistence.ts` |
| task-007 | e2e continuity verification + docs sync | test | web-client | task-006 | § Acceptance Criteria (Streams/State/Resize/Restore) · `packages/web-client/AGENTS.md` |
| task-008 | reopen client-side file/diff/molecule tabs | feature | workspace | task-006 | § Restoring a persisted layout (client-side kinds) · `features/workspace/reopen-client-tabs.ts` (new), `hooks/use-pane-layout.ts` |
| task-009 | persist + restore the workspace in view | bugfix | workspace, lib | task-008 | § Persisted layout record (`activeWorkspaceCwd`), § Restoring a persisted layout (view at settle point) · `features/workspace/restore-active-workspace.ts` (new), `lib/pane-layout-persistence.ts` |
| task-010 | status bar follows the focused pane | bugfix | stores | task-003 | § UI Behavior (focused pane) · `stores/tab-store.ts` |
| task-011 | restore-time unclaimed arrivals must not steal a claimed pane | bugfix | stores, hooks | task-006 | § Restoring a persisted layout (claim precedence) · `stores/layout-store.ts`, `hooks/use-session-restore.ts`, `hooks/use-terminal-restore.ts` |
| task-012 | open a pane by dragging a chat/file from a sidebar | feature | workspace, hooks, sessions, files | task-004, task-005 | § Drop regions/Drag sources, § Splitting · `features/workspace/external-drag.ts` (new), `hooks/use-external-pane-drop.ts` (new), `features/sessions/open-chat-tab.ts` (new), `SessionList.tsx`, `FileExplorer.tsx` |
| task-013 | restore seeds the sidebar/explorer/status bar from the workspace in view | bugfix | stores, hooks, workspace | task-009, task-011 | § Restoring a persisted layout (view target beyond the tab strip) · `stores/layout-store.ts` (`pendingActiveWorkspace`), `hooks/use-session-restore.ts`, `features/workspace/restore-active-workspace.ts` |

## Coverage check

| Spec / module | Covered by |
|---------------|-----------|
| features/workspace-split-panes.md § Pane tree, Splitting, Removing | 048/task-001 |
| § Geometry, Resizing | 048/task-002, 049/task-003 |
| § Persisted layout record, Tab identity, Data & Persistence | 048/task-003, 048/task-005, 049/task-006 (agent-id identity + bind trigger) |
| § Tab ↔ pane assignment, Programmatic splits, Moving a tab | 048/task-004, 049/task-001, 049/task-005 |
| § Restoring a persisted layout | 048/task-006, 049/task-006 (reopening every claimed conversation), 049/task-008 (client-side kinds), 049/task-011 (unclaimed arrivals never steal a claimed pane), 049/task-013 (sidebar/explorer/active-chat follow the view target) |
| § Panel continuity invariant | 049/task-002, verified live in 049/task-007 |
| § Drop regions, Resolving a drop region, Drag sources | 049/task-004 (tab drags), 049/task-012 (sidebar drags: chat + file rows) |
| § UI Behavior | 049/task-003, 049/task-004, 049/task-005, 049/task-010 (focused-pane status bar), 049/task-013 (restored-workspace sidebar + status bar) |
| § Error Handling & Edge Cases | distributed: 048/task-003 (persistence rows), 048/task-006 (claim rows), 049/task-004 (drop rows), 049/task-012 (drag-source rows) |
| § Acceptance Criteria | unit-level throughout; live Streams/Restore groups in 049/task-006 |
| features/workspace-ui.md § Pane / split model, § Mounted-tab keepalive | 049/task-002 (invariant), 049/task-003 (chrome) |

No gaps. Out of scope by spec: cross-client sync of arrangements (open TODO(verify) in the spec),
mobile/non-web split support, pane-focus keyboard shortcuts (deferred to keyboard-shortcuts scope).

## Open questions — TODO(verify)

- [ ] Whether split arrangements should be shareable/synced across clients (spec TODO; plan assumes
      strictly per-client).
- [ ] 049/task-005: Split right/down placement — trailing icon buttons vs. `NewTabMenu` entries —
      is a width-constraint judgment call left to the implementer (documented in the task).
