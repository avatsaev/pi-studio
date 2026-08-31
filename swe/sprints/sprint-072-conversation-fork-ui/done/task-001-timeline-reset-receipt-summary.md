# Task 001 — `agent_timeline_reset` receipt + from-scratch timeline refetch - Summary

**Sprint:** sprint-072-conversation-fork-ui
**Completed:** 2026-08-26
**Status:** done

## What was implemented

The fork convergence backbone: a connection-lifetime listener for the daemon's `agent_timeline_reset`
broadcast (sprint-071/task-003) that drops a cached agent's timeline entirely and refetches it from
scratch, paging to completion. Every later task in this sprint (the fork affordance, dialog, picker,
completion handling) will trigger real forks; this task makes the resulting convergence provable on
its own, with no UI in front of it yet.

## Files created / changed

- `packages/web-client/src/hooks/use-timeline-reset-watch.ts` — new. `AgentTimelineResetMessage`
  interface + `isAgentTimelineReset` type guard (local, no protocol-package schema — mirrors
  `use-terminal-exit-watch.ts`'s `terminals_update` precedent exactly). `handleAgentTimelineReset`
  — the pure-enough async core: no-ops for an agent this client has no cached session for; otherwise
  pages `fetch_agent_timeline` to completion via the existing `fetchTimelineEvents` helper (always
  starting at `cursor: null`), replays the events, and calls the new store action. `useTimelineResetWatch`
  — the React-effect wrapper wiring it to `client.connection.onSessionMessage`.
- `packages/web-client/src/stores/session-store.ts` — added `setTimeline(sessionId, timeline)` and
  `setTimelineByAgentId(agentId, timeline)`: unconditional wholesale replace (the fork-resync
  counterpart to `applyStreamEvent`'s incremental updates), recomputing `userMessageCount` from the
  replacement rows. Both are no-ops on an unknown id, matching every other `*ByAgentId` action's
  existing convention in this file.
- `packages/web-client/src/app.tsx` — mounted `useTimelineResetWatch()` in `Boot()`, alongside
  `useTerminalExitWatch()`.
- `packages/web-client/src/hooks/use-timeline-reset-watch.test.ts` — new. Covers the type guard
  (well-formed, missing reason, unrecognised reason, malformed/wrong-type/non-object rejections) and
  `handleAgentTimelineReset` against a fake `PiStudioClient` stub (paging to completion across two
  pages, cursor always starting `undefined`/null, optimistic-row clearing as a side effect of the
  full replace, and the no-op-for-unknown-agent path with zero client calls).
- `packages/web-client/src/stores/session-store.test.ts` — added a `setTimeline` describe block:
  wholesale replace + `userMessageCount` recompute, optimistic-row clearing, no-op on an unknown
  `sessionId`, `setTimelineByAgentId` resolving the right session, no-op on an unknown `agentId`.
- `packages/web-client/AGENTS.md` — extended the `session-store` and `hooks/` source-layout bullets
  with the new action/hook; appended a "Conversation fork (sprint-072)" `## Invariants` entry
  documenting the full-replace design, why optimistic-row clearing needs no separate code path, the
  no-op-for-uncached-agent guard, `reason`'s deliberate opacity, and the live browser verification.

## How it satisfies the scope

Every "What to build" bullet in the task file is implemented exactly as specified: a local
interface + type guard (no protocol schema), a listener that drops rows+cursors, refetches from
`cursor: null` paging to completion, and clears pending optimistic rows (for free, as a side effect
of the full replace) — with a no-op guard for agents this client has no cached timeline for.

## Build & test results

- `npm run build`: succeeded across every package.
- `npx tsc -b --force`: clean, zero errors.
- `npm run lint`: exit 0, zero errors; zero warnings on every touched file.
- `npm test`: 198 test files, 2630 tests, all passed (was 197/2617 before this task — +13 new tests:
  8 in `use-timeline-reset-watch.test.ts`, 5 net-new in `session-store.test.ts`).
- **Manual live verification** (real dev daemon + mock provider, real Vite dev server, real headless
  browser tab, driven end to end through the actual app UI): connected, opened a `/tmp` workspace,
  sent a message to materialize a mock agent, confirmed the transcript. A scripted `agent_fork_request`
  against the mock provider (as the task's own verification plan specifies) confirmed the daemon-side
  behavior already verified in sprint-071 — the mock's stub fork does not rebind, so no
  `agent_timeline_reset` broadcast is emitted, and nothing in this task's own client code path fires.
  To prove the client-side convergence pipeline itself (which needs an actual handle-changing fork —
  out of reach without a real, credentialed `pi` provider), the exact wire envelope the daemon sends
  (`{type: "session", message: {type: "agent_timeline_reset", agentId, reason: "fork"}}`) was
  injected directly into the same live, connected browser tab's real WebSocket (captured via a
  `page.evaluateOnNewDocument` proxy around `window.WebSocket`, installed before the app loaded).
  Result: exactly one new outgoing frame — `fetch_agent_timeline_request` for the correct `agentId`,
  `direction: "after"`, `limit: 200`, no `cursor` field (confirming the refetch started at
  `cursor: null`) — and the transcript re-rendered with its correct, unbroken content, with no page
  reload. This is the real end-to-end client pipeline (real hook → real store action → real RPC →
  real re-render) exercised against the real wire shape the daemon actually sends.

## Acceptance criteria

- [x] On receipt, the agent's cached rows and cursors are dropped and a fresh `cursor: null` fetch
      runs, paging until `hasNewer` is exhausted.
- [x] Pending optimistic user rows for that agent are cleared by the reset.
- [x] A reset for an unknown/uncached agent is a silent no-op — no fetch issued.
- [x] An unrecognised `reason` still triggers a full reset (reason is opaque).
- [x] No cursor from before the reset is ever reused (verified by asserting the refetch starts null).

## Follow-ups / TODO(verify)

None. The fork affordance, dialog, picker, and composer prefill are later tasks in this sprint and
build on this convergence backbone without needing any change to it.
