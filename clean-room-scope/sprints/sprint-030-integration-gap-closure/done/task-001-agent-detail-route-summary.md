# Task 001 — Agent detail route & screen assembly — Summary

- **Sprint:** sprint-030-integration-gap-closure
- **Completed:** 2026-07-06
- **Status:** done

## What was implemented
Replaced the `PlaceholderScreen` at `/h/:serverId/agent/:agentId` with a real standalone Agent
detail screen. The screen shows a header (title, provider, live status badge, action buttons) above
the shared timeline + composer conversation surface. Header actions call the correct SDK methods
(interrupt / resume / archive) and open-in-workspace navigates to the workspace route with an
`agent:` open intent. Unknown/archived agents render a not-found state instead of crashing.

The timeline+composer composition previously inlined in `PaneContentRouter.AgentPane` was extracted
into a shared `AgentConversation` component so the workspace pane and the standalone page render from
one source of truth (no duplication, no behavior change to the workspace pane).

## Files created / changed
| File | Change |
|------|--------|
| `packages/app/src/screens/agent-detail.ts` | created — pure gate/action view-model logic |
| `packages/app/src/screens/agent-detail.test.ts` | added — 10 tests |
| `packages/app/src/components/timeline/AgentConversation.tsx` | created — shared timeline+composer surface |
| `packages/app/src/components/screens/AgentDetailScreen.tsx` | created — presentational header + gate |
| `packages/app/src/router/LiveAgentPage.tsx` | created — live wiring (hooks + navigation + SDK) |
| `packages/app/src/components/workspace/PaneContentRouter.tsx` | modified — AgentPane now delegates to `AgentConversation`; removed now-unused imports |
| `packages/app/src/router/routes.tsx` | modified — route mounts `LiveAgentPage`; removed unused `PlaceholderScreen` import |

## How it satisfies the scope
- `features/app-navigation-screens.md` § Sessions/agent routing: the `/h/:serverId/agent/:agentId`
  route is now a real screen; the Sessions list already navigates here via `routes.agent(...)`.
- `features/agent-sessions.md` § interrupt/resume/archive: header actions map to
  `client.agent(id).interrupt() / resume() / archive()`; action availability is status-gated
  (interrupt only while running, resume when idle/error/closed).
- Gate resolution avoids a not-found flash during the initial connect window (loading while
  `connection.status === "connecting"`).

## Build & test results
```
$ npx tsc -p packages/app/tsconfig.json --noEmit
(exit 0)

$ npx vitest run packages/app/src/screens/agent-detail.test.ts
Test Files  1 passed (1)   Tests  10 passed (10)

$ npx vitest run packages/app         # regression check after the AgentPane refactor
Test Files  72 passed (72)   Tests  1252 passed (1252)

$ npm run build:web                   # (packages/app)
✓ built in 1.54s  (exit 0)
```

## Acceptance criteria
- [x] `h/:serverId/agent/:agentId` renders a live timeline + composer, not a placeholder. (LiveAgentPage → AgentConversation)
- [x] Header actions (interrupt / archive / resume / open-in-workspace) call the correct SDK methods. (LiveAgentPage.handleAction; gating verified by `agent-detail.test.ts`)
- [x] Navigating from the Sessions list to an agent opens this screen. (SessionsScreen `onSelectSession` → `routes.agent`)
- [x] Unknown/archived agent shows a not-found state, not a crash. (AgentDetailScreen gate; `resolveAgentDetailGate` tests)

## Follow-ups / TODO(verify)
- Open-in-workspace uses `entry.workspaceId ?? agentId` (dev-mode 1:1 synthesis). Confirm the
  authoritative workspace-id mapping once multi-agent workspaces are exercised end-to-end.
- The standalone screen reuses the workspace conversation surface; a dedicated compact/mobile
  layout for this route (if desired) is deferred to sprint-028 responsive work.
