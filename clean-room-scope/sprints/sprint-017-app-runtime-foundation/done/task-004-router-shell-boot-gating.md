# Task 004 — Router shell, boot resolver & route gating

- **Sprint:** sprint-017-app-runtime-foundation
- **Status:** backlog
- **Estimated size:** M
- **Depends on:** task-002, task-003; sprint-013/task-001 (route grammar, boot resolver, app shell)

## Goal
Map the sprint-013 route grammar onto a **`react-router` data router**, wire the boot resolver
(splash → welcome/host/workspace), and render the top-level app shell region into which sprint-018+
screens mount.

## Scope references
- `clean-room-scope/features/app-navigation-screens.md` § routes & route grammar
- `clean-room-scope/architecture/client-app-runtime.md` § boot, § platform rules

## What to build
- A `react-router` route tree mirroring the grammar: `/welcome`, `/pair-scan`, `/new`, `/open-project`,
  `/sessions`, `/schedules`, `/settings/*`, and host-scoped `/h/:serverId/(index|sessions|settings|
  open-project|agent/:agentId|workspace/:workspaceId)`. Route params typed; deep-link/`?open=` search
  params preserved.
- The boot resolver: on load, resolve saved hosts / startup blocker → route to splash, `/welcome`,
  a host home, or a saved workspace (consume the sprint-013 boot-resolver view model).
- The app-shell layout region (header slot + left-sidebar slot + content outlet + global portal/toast
  host mount points) — placeholders that sprint-018 fills with real chrome.
- `getIsElectron()`-gated route/behavior differences (e.g. desktop-only entries) via the module-selection
  policy.

## Out of scope
- Left sidebar / command center / chrome components (sprint-018/task-003). Individual screens
  (sprint-019+). Workspace shell (sprint-020).

## Acceptance criteria
- [ ] All grammar routes resolve to a mounted (placeholder) screen with typed params.
- [ ] The boot resolver routes first paint correctly for: no hosts → `/welcome`; saved host → host home;
      saved workspace deep-link → workspace route.
- [ ] `?open=` and agent/workspace deep-link params reach the target route unchanged.

## Test / verification plan
- Tests: route-grammar ↔ path mapping (build path from params + parse back); boot-resolver decision
  table (reuse sprint-013 model) → expected initial route.

## Notes
- This closes the foundation sprint: after it, the app boots to real routes with empty screens that
  later sprints implement.
