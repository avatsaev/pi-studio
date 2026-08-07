# Task 009 — Persist and restore the workspace in view

- **Sprint:** sprint-049-workspace-split-panes-ui
- **Status:** in_progress — code + tests + docs done; live check is the user's
- **Type:** bugfix
- **Depends on:** task-008
- **Size:** S

## Why

Reported from the live smoke test: *"when I connect, the last opened workspace and its panes are not
opened, I always see a new chat tab"* — followed by the decisive observation: *"when I click a specific
workspace chat then the panels are correctly restored."*

So the panes were never lost. The **view** was wrong. Pane geometry is persisted *per workspace*, but
nothing recorded which workspace the user was looking at, so after restore the view fell to whoever
opened the last tab — in practice `use-session-restore`'s `order[0]`, the most recently active *agent*.
With two workspaces open that is a coin flip, and landing on a single-paned workspace looks exactly
like a lost layout.

## Change

1. `PersistedPaneLayout` gains an optional top-level `activeWorkspaceCwd`; `writePaneLayout` writes
   `tab-store.activeWorkspaceCwd`.
2. `loadPaneLayout` now returns `LoadedPaneLayout` (`{ workspaces, activeWorkspaceCwd }`) and drops the
   active workspace if its own entry failed validation — landing on a workspace with no geometry would
   be worse than not switching.
3. `features/workspace/restore-active-workspace.ts` — `installActiveWorkspaceRestore(cwd)` arms on
   connect and fires **at the hydration settle point**:
   - waits for settle, because every `open()` brings its own workspace into view, so an earlier switch
     is simply overwritten by the next arriving tab;
   - **one-shot**, so a user who switches workspaces mid-restore is never yanked back;
   - refuses when that workspace has no live tab, or no layout, or is already in view.

## Acceptance

- [x] The record round-trips `activeWorkspaceCwd`; absent when no workspace is in view.
- [x] A record naming a damaged workspace entry loads with `activeWorkspaceCwd: null`.
- [x] After restore opens tabs in two workspaces, the persisted one ends up in view, with its focused
      pane's active tab active.
- [x] Nothing happens mid-restore (one source reported) — the switch waits for both.
- [x] A user switch after the settle point stands; later layout mutations do not pull the view back.
- [x] Refuses on: no layout, no restored tab, already in view, nothing persisted.
- [ ] **Live:** two workspaces, split panes in the non-most-recent one, reload → land back in it with
      its panes — user-verified.

## Verification

`restore-active-workspace.test.ts` (8 tests) + 2 record tests in `pane-layout-persistence.test.ts`;
full suite 557 passing, forced `tsc -b --force` clean, build ✓.

## Note on tooling found here

`npm run typecheck` (`tsc -b`, incremental) reported **0 errors** on a tree where
`npx tsc -b packages/web-client --force` reported **9** — a stale `.tsbuildinfo` silently skipped the
project. Use `--force` (or `npm run clean`) when a signature changes; an incremental pass is not proof.
