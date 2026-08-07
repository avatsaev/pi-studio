# Task 003 — Timeline Subscription & Streaming Render — Summary

- **Sprint:** sprint-024-workspace-wiring
- **Completed:** 2026-07-06
- **Status:** done

## What was implemented

`useAgentTimelineSubscription` — React hook that wires an agent's timeline from the session
store to render-ready items, performs initial page fetch + live stream subscription, manages
autoscroll state, and supports pagination.

### Files created
| File | Description |
|------|-------------|
| `packages/app/src/hooks/use-timeline-hooks.ts` | `useAgentTimelineSubscription` hook |
| `packages/app/src/hooks/use-timeline-hooks.test.ts` | 14 tests |
| `PaneContentRouter.tsx` | Updated: `AgentPane` now uses the hook for real rows |

## How it satisfies the scope

| Scope requirement | Implementation |
|---|---|
| `useAgentTimeline(agentId)` → render items | `useAgentTimelineSubscription` → `buildRenderItems(rows)` |
| Initial page fetch on mount | `planInitialSync` → `client.agent(id).timeline.fetch(...)` → `store.mergePage` |
| Live stream subscription | `client.agent(id).timeline.subscribe(event => store.applyStreamEvent)` |
| Load older pages (scroll-to-top) | `loadOlder()` → fetch `direction: "before"` with stored cursor |
| Autoscroll state machine | Full delegation to `onRowsAdded`, `onScroll`, `onJumpToBottom`, `onScrollComplete` |
| "N new messages" pill while detached | `newMessageCount` incremented when rows arrive in detached mode |
| All row types render correctly | `buildRenderItems` maps any `TimelineRow` kind to `RenderItem` |

## Build & test results

```
$ npx tsc -b packages/app   → no errors
$ npm test                   → 108 files, 1454 tests passed
```

## Acceptance criteria
- [x] Live agent output streams into timeline — hook subscribes via `client.agent.timeline.subscribe`
- [x] Scrolling up pauses autoscroll → "new messages" count increments — tested
- [x] Loading older messages prepends — `loadOlder()` fetches `direction: before`
- [x] All row types render — `buildRenderItems` handles any row kind
