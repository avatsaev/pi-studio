# Task 001 — Agent detail route & screen assembly

- **Sprint:** sprint-030-integration-gap-closure
- **Status:** done
- **Estimated size:** M
- **Depends on:** sprints 024, 026, 029 (workspace wiring, timeline-full, final app shell)

## Goal
Replace the `PlaceholderScreen` currently mounted at `h/:serverId/agent/:agentId`
(`packages/app/src/router/routes.tsx`) with a real agent-detail screen so an agent that is
not currently opened as a workspace tab can still be observed and driven (timeline + composer +
header actions), matching the reference app's standalone agent view.

## Scope references
- `clean-room-scope/features/app-navigation-screens.md` § sessions / agent detail
- `clean-room-scope/features/agent-sessions.md`
- `clean-room-scope/features/timeline-rendering.md`, `features/composer-ui.md`
- Reference (Paseo): `packages/app/src/app/*` agent routing + `agent-stream/view.tsx`

## What to build
- A `LiveAgentPage` (router) that resolves `serverId` + `agentId` from the route, subscribes to
  the agent timeline via the existing `use-timeline-hooks`, and renders the timeline + composer
  using the already-built components (no new timeline/composer logic).
- Header showing agent title, provider, status (via `use-session-hooks`), and actions:
  open-as-workspace, interrupt, archive, resume.
- Wire the route in `routes.tsx` to the new page (remove the placeholder).
- "Open in workspace" navigates to the workspace route and seeds a draft/agent tab.
- Loading + not-found gates reusing the existing gate/skeleton primitives.

## Acceptance criteria
- [ ] `h/:serverId/agent/:agentId` renders a live timeline + composer, not a placeholder.
- [ ] Header actions (interrupt / archive / resume / open-in-workspace) call the correct SDK methods.
- [ ] Navigating from the Sessions list to an agent opens this screen.
- [ ] Unknown/archived agent shows a not-found state, not a crash.

## Test / verification plan
- Unit: route resolver picks the correct serverId/agentId; gate logic for missing agent.
- Component: mock timeline hook → verify rows render; mock status → verify header actions enabled/disabled.
- `npx vitest run` on new test files; `npm run build:web` succeeds.
