# Task 001 — Virtualized timeline list, row dispatch & autoscroll

- **Sprint:** sprint-021-timeline-composer-screens
- **Status:** backlog
- **Estimated size:** L
- **Depends on:** sprint-020; sprint-015/task-001 (reducers, render model, row dispatch, autoscroll)

## Goal
Render the agent timeline as a virtualized list driven by the sprint-015 render model, with row
dispatch, autoscroll/jump-to-latest, and live+paged consistency.

## Scope references
- `clean-room-scope/features/timeline-rendering.md` § list, § autoscroll
- `clean-room-scope/architecture/client-app-runtime.md` § timeline view consistency

## What to build
- A `Timeline` list using `@tanstack/react-virtual` fed by `buildRenderItems`; measure/estimate row
  heights, sticky behavior where needed; dispatch each row to a renderer via `dispatchRow`.
- Autoscroll state machine wiring (stick-to-bottom, show "jump to latest" when scrolled up, jump action)
  from sprint-015 `autoscroll.ts`; live `agent_stream` rows appended, authoritative paged fetch merged.
- Scroll-driven older-history paging (fetch `before`) + resume-from-cursor behavior.
- Row renderer registry with placeholders for message/tool/diff/permission/activity kinds (filled by
  tasks 002–003).

## Out of scope
- Message/markdown rendering (task-002). Tool/diff/permission cards (task-003). Composer (task-004).

## Acceptance criteria
- [ ] The list virtualizes rows from the render model and dispatches each kind to a renderer.
- [ ] Autoscroll sticks to bottom, shows jump-to-latest when scrolled up, and jumps on action.
- [ ] Older history pages in on scroll; live rows append without losing scroll position.

## Test / verification plan
- Tests: render-item build + row dispatch mapping (reuse sprint-015 model); autoscroll transitions;
  paging merge (reuse sync-planner/reducer).

## Notes
- Keep the row renderer registry open for tasks 002–003 to register concrete components.
