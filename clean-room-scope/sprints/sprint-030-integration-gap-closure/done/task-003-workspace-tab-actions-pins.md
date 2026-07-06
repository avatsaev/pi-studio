# Task 003 — Workspace tab context actions & pinned quick-launch

- **Sprint:** sprint-030-integration-gap-closure
- **Status:** done
- **Estimated size:** M
- **Depends on:** sprint 014/020 (workspace shell), sprint 024 (workspace wiring)

## Goal
Close the wiring gaps left in `packages/app/src/router/LiveWorkspacePage.tsx`:
tab context actions marked `TODO(verify)` (rename / copy-resume / copy-agent-id / reload-agent)
and pinned quick-launch targets (`pinnedTargets={[]}`, `onPinnedLaunch` no-op). Match the
reference app's tab context menu and pinned launcher behavior.

## Scope references
- `clean-room-scope/features/workspace-ui.md` § tab context menu, § pinned quick-launch targets
- `clean-room-scope/features/agent-sessions.md` § resume / agent id
- Reference (Paseo): tab strip context actions + pinned targets

## What to build
- **Tab context actions**: rename (persist tab label), copy-resume (copy resume command/URL to
  clipboard), copy-agent-id (clipboard), reload-agent (re-subscribe / restart agent session via SDK).
- **Pinned quick-launch targets**: resolve real pinned targets from persisted workspace/project
  config; render in `TabStrip` and wire `onPinnedLaunch` to open the corresponding tab kind
  (draft/terminal/browser/file).
- Clipboard writes via the DOM clipboard API with a toast confirmation.

## Acceptance criteria
- [ ] Tab context menu items all perform their action (no silent no-ops).
- [ ] Copy actions place the correct text on the clipboard and toast success.
- [ ] Pinned targets render and launch the right tab kind.
- [ ] Rename persists across reload.

## Test / verification plan
- Unit: pinned-target resolution; rename persistence in the layout store.
- Component: mock clipboard → verify copy payloads; click pinned target → verify openTab call.
- `npx vitest run`; `npm run build:web` succeeds.
