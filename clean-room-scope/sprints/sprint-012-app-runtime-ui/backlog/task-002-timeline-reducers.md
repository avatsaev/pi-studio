# Task 002 — Timeline reducers + sync planner

- **Sprint:** sprint-012-app-runtime-ui
- **Status:** backlog
- **Estimated size:** M
- **Depends on:** task-001

## Goal
Implement the client-side timeline reducers and the authoritative sync planner (cursor paging,
sequence dedup, compaction).

## Scope references
- `clean-room-scope/architecture/client-app-runtime.md` § Timeline view consistency
- `clean-room-scope/features/timeline-streaming.md` § Client sync planning, § Behavior

## What to build
- `session-stream-reducers.ts`: apply live `agent_stream` immediately; reconcile against
  authoritative `fetch_agent_timeline` by sequence; compaction, gap detection, sequence-based dedup.
- Sync planner:
  - Resume WITH a cursor → fetch `direction:"after"` and page until `hasNewer:false` (never replace
    with a latest-tail page).
  - First load / resume WITHOUT a cursor → fetch a bounded latest tail page; older history is
    scroll-driven.
- Treat row `timestamp` as daemon-owned (no local-clock heuristics); presence/heartbeat never hides
  rows.

## Out of scope
- Visual timeline components (task-003).

## Acceptance criteria
- [ ] After reconnect with a cursor, the planner fetches `after` pages until `hasNewer:false`.
- [ ] A first load without a cursor fetches a bounded latest tail page.
- [ ] Live and authoritative rows converge (dedup by sequence); duplicates are removed.
- [ ] A tool-call spanning many sequences renders as one item.
- [ ] A stale heartbeat never removes rows.

## Test / verification plan
- Tests: `npx vitest run packages/app/.../sync-planner.test.ts`, `.../reducers.test.ts` — cursor
  paging to completion, no tail-skip, dedup, collapse.

## Notes
- This is pure logic (no rendering) — fully unit-testable.
