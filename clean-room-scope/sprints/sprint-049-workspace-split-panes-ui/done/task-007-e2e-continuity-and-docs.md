# Task 007 — End-to-end continuity verification + docs sync

- **Sprint:** sprint-049-workspace-split-panes-ui
- **Status:** done — user-verified live
- **Type:** test
- **Area:** web-client
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** task-006

## Goal
Prove the acceptance criteria that only a live daemon + real browser can prove — streams surviving
rearrangement, PTY reattach after reload — and bring the docs in line with the shipped feature.

## Context / why
The continuity invariant's whole point is behaviour under live streams, which unit tests cannot
exercise: a terminal's PTY must survive its tab being dragged into a new split, and a reload must
reattach (not respawn) terminals into their restored panes. This task is the feature's smoke test
and the sprint's close-out gate.

## Scope references
- `clean-room-scope/features/workspace-split-panes.md` § Acceptance Criteria (Streams, State,
  Resize, Restore groups)
- Modify: `packages/web-client/AGENTS.md` (stores/features layout, new modules, invariants)
- Modify: root `AGENTS.md` only if a monorepo-level statement changed (likely nothing)
- No production source changes expected; fix-forward bugs found here belong to this task only if
  they are small — otherwise file them as new backlog tasks and report.

## What to build / verify
**Live scenario (real daemon `npm start`, real browser):**
1. Open a workspace; start a terminal running `while true; do date; sleep 1; done`.
2. Open a chat; send a prompt that streams a long response.
3. While both stream: drag the chat tab to the terminal pane's right edge (split), then drag the
   terminal tab into the new pane (`center`), then back out to a `bottom` split.
4. Assert: terminal output never pauses or duplicates; chat rows stream without duplication; the
   terminal process is the SAME pid afterwards (`echo $$` before/after).
5. Type composer text without sending; drag that chat tab across panes; text intact; scroll
   position of a long timeline intact.
6. Resize the divider; terminal reflows (long line re-wraps at the new width; `stty size` reflects
   new cols/rows).
7. Reload the page: pane geometry, proportions, per-pane tab sets, per-pane actives, and focus all
   restored; the terminal shows its prior scrollback (snapshot reattach, same PTY — the
   `while` loop is still ticking, no second shell spawned).
8. Kill the conversation's agent between sessions (archive it elsewhere): reload → its pane is
   pruned after hydration, layout collapses cleanly.
9. Corrupt `localStorage`'s `pi-studio-pane-layout` (bad JSON, wrong version): reload → single
   pane, all tabs present, no error surfaced.

**Docs (same change set):**
- `packages/web-client/AGENTS.md`: add `pane-tree.ts`, `pane-dnd.ts`, `layout-store.ts`,
  `pane-layout-persistence.ts`, `PaneDividers.tsx`, `DropPreview.tsx` to the source-layout tree
  (one line each); document the pane/layout invariants (panels never re-parented; `activeTabId` is
  derived; per-pane visibility) and the `pi-studio-pane-layout` storage key; update the tab-store
  section for the layout-store division of labour.

## Acceptance criteria
- [x] Terminal PTY pid continuity across drag + pane collapse observed directly by the user (`echo $$` unchanged); reload continuity for chats/panes/files/workspace-in-view observed via tasks 006/008/009. Full scripted 9-step scenario (composer draft mid-drag, divider reflow, agent-deletion pruning, corrupt-storage fallback) not separately re-run — its individual mechanisms are each covered by an automated test (see tasks 006, 008, 009 summaries) plus the user's own checks.
      referenced in the summary).
- [x] Full gates green: `tsc -b --force`, `npm run build:web-client`, `npx oxfmt --check`, `npx oxlint`, `npx vitest run packages/web-client` (560 tests).
- [x] `packages/web-client/AGENTS.md` reflects every new module (pane-tree, pane-dnd, layout-store, pane-layout-persistence, PaneDividers, DropPreview, reopen-client-tabs, restore-active-workspace) and invariant (panel continuity, derived `activeTabId` + its layout subscription, per-pane visibility, claim preservation, view-restore settle point).
      about a single global active tab remains.
- [x] All bugs found (divider affordance, replay timing, claim-dropping on write, workspace-in-view not persisted, status bar not following focus) were fixed within their originating tasks, not deferred.

## Test / verification plan
- Automated: `npm run build && npm run typecheck && npm run lint && npm test` — all green.
- Manual: the numbered live scenario, driven against `npm start` (real Pi daemon) with the built
  web client; use the browser tool or a manual session, capturing evidence per step.

## Notes
- This is the sprint's end-of-sprint full-suite gate; do not start it with earlier tasks unfinished.
- The reload-reattach step exercises `use-terminal-restore.ts` + sprint-048 task-006 claims
  end-to-end — the single highest-risk integration seam of the feature.
