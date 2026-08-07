# Task 003 — Timeline subscription & streaming render

- **Sprint:** sprint-024-workspace-wiring
- **Status:** backlog
- **Estimated size:** L
- **Depends on:** task-002; sprint-023/task-001 (session store)

## Goal
Wire the Timeline component to the session store's stream items, implementing real-time streaming
of assistant messages (token-by-token append) and the sync planner for pagination.

## Scope references
- `clean-room-scope/features/timeline-rendering.md`
- `clean-room-scope/features/agent-sessions.md` § streaming events

## What to build
- **Stream subscription hook**: `useAgentTimeline(agentId)` → returns render items (from
  `buildRenderItems`), loading state, pagination controls (load-older / jump-to-latest).
- **Streaming append**: as `agent.stream.delta` events arrive, append tokens to the current
  assistant message in the store; the Timeline virtualizer re-measures the growing row.
- **Sync planner integration**: when user scrolls to top, trigger `planSync()` to fetch older
  messages; merge into store; virtualizer prepend-shifts without scroll jump.
- **Timeline row dispatch**: each `RenderItem` dispatches to the correct row component (from
  sprint-021): UserMessageRow, AssistantMessageRow, ToolCallCard, ActivityLogPill, CompactionMarker.
- **Autoscroll state machine**: active when at bottom; pause on user scroll-up; resume on
  jump-to-latest button press; new message while paused shows "N new messages" pill.

## Acceptance criteria
- [ ] Live agent output streams token-by-token into the timeline with smooth autoscroll.
- [ ] Scrolling up pauses autoscroll; "new messages" pill appears; clicking resumes.
- [ ] Loading older messages prepends without scroll jump.
- [ ] All row types render correctly from real daemon data.

## Test / verification plan
- Mock stream: emit deltas → verify assistant message grows in store → Timeline re-renders.
- Pagination: mock 100 items, initial fetch 50, scroll up → verify older 50 loaded.
- Autoscroll: simulate user scroll → verify pause; simulate new message → verify pill.
