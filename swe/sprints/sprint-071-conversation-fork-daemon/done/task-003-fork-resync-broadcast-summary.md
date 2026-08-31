# Task 003 — `handleFork` post-fork resync + `agent_timeline_reset` broadcast — Summary

- **Sprint:** sprint-071-conversation-fork-daemon
- **Completed:** 2026-08-26
- **Status:** done

## What was implemented

`handleFork` (`slash-command-operations.ts`) now resyncs the daemon's in-memory timeline and
notifies every connected client whenever a fork actually rebinds the provider process.

- Reads `record.persistence?.nativeHandle` before and after the existing `persistSessionHandle`
  call. If it changed (and isn't cancelled), hydrates the forked branch via
  `resolveClient(record.provider).hydrateTimeline?.(handle) ?? []`, installs it with
  `resetTimeline`, and broadcasts `{ type: "agent_timeline_reset", agentId, reason: "fork" }` to
  every active session (`getSessions()`, passed in from `registerHandlers`, following the
  `terminals_update` passthrough-push convention — no `messages.ts` union member).
- The guard is "handle changed", not "rows non-empty" or "provider is pi": provider-agnostic, so
  the mock provider's inert stub fork (which changes no handle) resets nothing.
- The RPC response is returned after the reset + broadcast complete, never before.

## Files created / changed

| File | Change |
|------|--------|
| `packages/server/src/agent/slash-command-operations.ts` | `handleFork` extended with the resync guard + broadcast; registration now passes `getActiveSessions` |
| `packages/server/src/agent/slash-command-ops.test.ts` | fixed 2 pre-existing `handleFork(...)` call sites for the new required param; added `describe("agent_fork_request — post-fork resync …")` with 5 tests |

## How it satisfies the scope

Implements `swe/features/conversation-fork.md` § Daemon: post-fork resync exactly, including the
handle-change (not row-count) guard and response-after-broadcast ordering. `resetTimeline`
(task-002) and `hydrateTimeline` (existing, `timeline-rpc.ts`'s restart path) needed no changes —
this task only wires them together.

## Build & test results

```
$ npm run build:server
success (tsc -b, no errors)

$ npx vitest run packages/server/src/agent
Test Files  26 passed (26)
     Tests  375 passed (375)
(slash-command-ops.test.ts: 38 tests, 5 new)

$ npx oxfmt <changed files>; npx oxlint <changed files>
clean (no diffs, zero lint errors)
```

**Manual verification** — real `npm run dev:daemon` (mock provider) + a scripted
`agent_fork_request` over a real WebSocket connection via `@av-pi-studio/client`:

```
forkTimelineSync feature: true
rewind feature (must be absent): false
rows before fork: 4
fork result: {"text":"mock forked text for some-entry-id","cancelled":false}
rows after fork: 4
saw agent_timeline_reset broadcast: false
RESULT: mock fork leaves timeline untouched and emits no broadcast: PASS
```

## Acceptance criteria

- [x] A fork that changes the native handle resets the in-memory timeline to the hydrated branch
      and broadcasts `agent_timeline_reset` to every active session (unit-tested).
- [x] A fork whose hydration yields zero rows still resets and still broadcasts (unit-tested).
- [x] `{cancelled: true}` performs no reset and no broadcast (unit-tested).
- [x] A mock-provider fork (no handle change) performs no reset and no broadcast — verified both by
      unit test and live against a running dev daemon (see manual verification above).
- [x] The success response is observably emitted after the reset+broadcast (unit-tested via an
      ordering array: `["hydrate", "broadcast:agent_timeline_reset", "response resolved"]`).

## Follow-ups / TODO(verify)

- Resolved: `persistSessionHandle` needs no extra record fetch — `AgentManager.get(agentId)` is an
  in-memory `Map` lookup, so reading the handle before/after costs nothing extra.
