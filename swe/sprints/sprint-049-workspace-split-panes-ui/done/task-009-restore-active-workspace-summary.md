# Task 009 summary — Persist and restore the workspace in view

- **Sprint:** sprint-049-workspace-split-panes-ui
- **Status:** done — user-verified live
- **Written:** 2026-08-03

## The diagnosis, and how it was reached

The report was *"the last opened workspace and its panes are not opened, I always see a new chat tab"*.
The decisive follow-up was the user's own: *"when I click a specific workspace chat then the panels are
correctly restored."* That ruled out the entire claim/pruning path — the panes were being restored
faithfully, in the right workspace, with the right sizes. Only the **view** was wrong.

Cause: geometry is persisted per workspace, but nothing recorded which workspace was in view. After
restore the view therefore belonged to whoever opened the last tab, which is `use-session-restore`'s
`order[0]` — the most recently active *agent*, not the most recently *viewed workspace*. With two
workspaces open that is a coin flip. The "new chat tab" was that agent: an empty draft, whose title
defaults to "New chat".

## What changed

- `PersistedPaneLayout.activeWorkspaceCwd` (optional, top-level) — written from
  `tab-store.activeWorkspaceCwd`.
- `loadPaneLayout` now returns `LoadedPaneLayout` (`{ workspaces, activeWorkspaceCwd }`), dropping the
  active workspace when its own entry failed validation.
- `features/workspace/restore-active-workspace.ts` — `installActiveWorkspaceRestore(cwd)` arms on
  connect, fires at the hydration settle point, and switches once.

Three constraints, each of which a naive implementation gets wrong:

1. **Wait for the settle point.** Every `open()` brings its own workspace into view, so switching on the
   first arriving tab is simply overwritten by the next one. The last writer has to be this.
2. **One-shot.** A user who switches workspaces while restore is in flight must never be yanked back.
3. **Refuse when there is nothing there.** No layout, no live tab, or already in view → do nothing.
   Landing on an empty workspace whose sessions were all deleted is worse than staying put.

## Files changed

| File | Change |
|---|---|
| `features/workspace/restore-active-workspace.ts` | new — `installActiveWorkspaceRestore`, `restoreActiveWorkspace` |
| `features/workspace/restore-active-workspace.test.ts` | new — 8 tests |
| `lib/pane-layout-persistence.ts` | `activeWorkspaceCwd` on the record; `LoadedPaneLayout` return shape |
| `lib/pane-layout-persistence.test.ts` | +2 record tests, call sites updated for the new shape (22 in file) |
| `hooks/use-pane-layout.ts` | passes `loaded.workspaces`, arms the view restore on connect |
| `packages/web-client/AGENTS.md` | "Which workspace is in view is persisted state" invariant (with the symptom); layout entries for the new module and the record fields |
| `clean-room-scope/features/workspace-split-panes.md` | § Persisted layout record: `activeWorkspaceCwd` + rationale; § Restoring: settle-point view restore and its three constraints |
| `clean-room-scope/PLAN.md` | task-009 row, sprint task count 8 → 9, coverage rows |

## Commands run

| Command | Result |
|---|---|
| `npx vitest run .../restore-active-workspace.test.ts` | **8 passed** |
| `npx vitest run .../pane-layout-persistence.test.ts` | **22 passed** |
| `npx vitest run packages/web-client` | **45 files, 557 passed** |
| `npx tsc -b packages/web-client --force` | ✅ clean |
| `npm run build:web-client` | ✅ built |
| `npx oxfmt --check` / `npx oxlint` | ✅ clean, no new warnings |

## Tooling defect found while verifying

`npm run typecheck` (`tsc -b`, incremental) reported **0 errors** on a tree where
`npx tsc -b packages/web-client --force` reported **9** — a stale `.tsbuildinfo` had the project marked
up to date, so the changed `loadPaneLayout` signature went unchecked; the failure only surfaced when
vitest hit it at runtime. Treat an incremental `typecheck` as unproven after a signature change: use
`--force`, or `npm run clean` first. Worth fixing in the root script.

## Live verification

User confirmed working ("all good") on 2026-08-03, including the terminal-pid check (`echo $$` before/after drag + pane collapse — same pid).

1. Two workspaces, splits in the one that is **not** your most recent conversation → reload → land back
   in it, panes intact, correct active tab per pane.
2. Most-recent chat in a *different* workspace than the split one — the case that was broken.
3. Switch workspaces immediately after connecting, mid-restore → you stay where you clicked.
4. Delete every session in the persisted workspace, reload → no switch to an empty workspace.
