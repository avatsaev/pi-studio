# Task 003 — Workspace tab context actions & pinned quick-launch — Summary

- **Sprint:** sprint-030-integration-gap-closure
- **Completed:** 2026-07-06
- **Status:** done

## What was implemented
Closed the wiring gaps in `LiveWorkspacePage`:
- **Tab context actions** — `copy-resume` and `copy-agent-id` write to the clipboard with a toast;
  `reload-agent` calls `client.agent(id).resume()` with a toast; `rename` prompts for a label and
  persists it; the full close family (`close`, `close-others`, `close-left/right/above/below`) is
  handled. No silent no-ops remain.
- **Pinned quick-launch targets** — loaded from the persisted `PinnedTargetsStore` (defaults:
  terminal + browser) and rendered in `TabStrip`; `onPinnedLaunch` opens the corresponding tab kind.
- **Rename persistence** — custom labels are stored per-workspace in a new `TabLabelsStore` (the
  workspace layout persistence only serializes the pane tree, so labels needed their own store) and
  merged into the tab strip via `mergeTabLabels`, surviving reload.

All the branching/targeting/persistence logic lives in the pure, unit-tested `tab-actions.ts`.

## Files created / changed
| File | Change |
|------|--------|
| `packages/app/src/workspace/tab-actions.ts` | created — resume/clipboard payloads, close-to-side targeting, `TabLabelsStore`, `mergeTabLabels` |
| `packages/app/src/workspace/tab-actions.test.ts` | added — 14 tests |
| `packages/app/src/router/LiveWorkspacePage.tsx` | modified — wired context actions, pinned targets, rename + toast + clipboard |

## How it satisfies the scope
- `features/workspace-ui.md` § Tab operations / context menu: every menu id emitted by
  `tabContextMenu` (copy-resume, copy-agent-id, reload-agent, rename, close-*) now performs an action.
- `features/workspace-ui.md` § Pinned quick-launch targets: reuses the existing `PinnedTargetsStore`
  + `quickLaunchButtons`; launch opens `button.tabTarget`.
- `features/agent-sessions.md` § resume/agent id: resume command is `pi-studio agent attach <id>`
  (matches the CLI `agent attach`); reload uses the `resume_agent` RPC via the client handle.
- Rename persistence uses a dedicated KV-backed store because `WorkspaceLayoutStore.save` only
  persists the pane layout (tab ids), not per-tab metadata.

## Build & test results
```
$ npx tsc -p packages/app/tsconfig.json --noEmit          # exit 0

$ npx vitest run packages/app/src/workspace/tab-actions.test.ts
Test Files  1 passed (1)   Tests  14 passed (14)

$ npx vitest run packages/app
Test Files  74 passed (74)   Tests  1275 passed (1275)

$ npm run build:web        # (packages/app)  ✓ built
```

## Acceptance criteria
- [x] Tab context menu items all perform their action (no silent no-ops). (`handleTabContextAction` covers copy/reload/rename/close-*; targeting verified by `tabIdsToClose` tests)
- [x] Copy actions place the correct text on the clipboard and toast success. (`clipboardPayloadFor` tested; `navigator.clipboard.writeText` + `toast.copied`)
- [x] Pinned targets render and launch the right tab kind. (`pinnedStore.load()` → `TabStrip`; `handlePinnedLaunch` → `openTab(button.tabTarget)`)
- [x] Rename persists across reload. (`TabLabelsStore` round-trip test simulates reload)

## Follow-ups / TODO(verify)
- Rename uses `window.prompt` for the dev pass; the reference app's inline rename dialog
  (`rootModals: ["rename-tab"]` in `composition.ts`) can replace it in sprint-028 polish.
- `reload-agent` maps to the `resume_agent` RPC; confirm the provider's exact reload semantics
  (re-subscribe vs. restart) against the daemon when a non-mock provider is exercised.
