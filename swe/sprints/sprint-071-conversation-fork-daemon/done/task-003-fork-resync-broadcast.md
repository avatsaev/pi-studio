# Task 003 — `handleFork` post-fork resync + `agent_timeline_reset` broadcast

- **Sprint:** sprint-071-conversation-fork-daemon
- **Status:** done
- **Type:** feature
- **Area:** server/agent
- **Priority:** P1
- **Estimated size:** M
- **Depends on:** task-002

## Goal

Make a successful fork resync the daemon's in-memory timeline to the new branch and tell every
connected client to refetch — closing the gap where a fork rebinds the `pi` process but leaves every
transcript showing the abandoned branch.

## Context / why

`handleFork` (`slash-command-operations.ts:178`) already forks the session and calls
`AgentManager.persistSessionHandle` so the record's `persistence.nativeHandle` points at the NEW
branched file. What it does not do is update the in-memory timeline — so every client keeps rendering
the abandoned branch until it reconnects. Nothing consumes the fork RPCs yet, so nobody has hit this;
a fork UI makes it mandatory.

No truncation math is needed: `AgentClient.hydrateTimeline(handle)` (pi:
`hydrateTimelineFromSessionFile` → `SessionManager.open(file).getBranch()`) rebuilds a complete
`TimelineRow[]` from the JSONL the handle now points at, which post-fork **is** the forked branch.
`timeline-rpc.ts` already uses this exact path for restarted daemons.

## Scope references

- `swe/features/conversation-fork.md` § Daemon: post-fork resync, § New broadcast:
  `agent_timeline_reset`, § Error handling & edge cases
- `packages/server/src/agent/slash-command-operations.ts` — `handleFork`
- `packages/server/src/agent/agent-service.ts` — `resetTimeline` (task-002)
- `packages/server/src/agent/timeline-rpc.ts` — the existing `hydrateTimeline` usage to mirror
- `packages/server/src/terminal/terminal-rpc.ts` — `terminals_update`, the broadcast convention to copy
- `packages/server/src/agent/providers/mock/mock-provider.ts:369-375` — the inert stub fork

## What to build

Extend `handleFork` after the existing fork + `persistSessionHandle` calls:

```
payload = session.fork(entryId)                          # existing
if payload.cancelled: return payload                     # existing — nothing rebinds
handleBefore = record.persistence?.nativeHandle
manager.persistSessionHandle(agentId)                    # existing
handleAfter  = record.persistence?.nativeHandle

if handleAfter != null AND handleAfter != handleBefore:   # a rebind actually happened
    rows = resolveClient(record.provider).hydrateTimeline?.(record.persistence) ?? []
    resetTimeline(agentId, rows)                         # rows MAY legitimately be empty
    broadcast({ type: "agent_timeline_reset", agentId, reason: "fork" })
return payload                                           # sent AFTER reset + broadcast
```

- **The guard is "handle changed", not "rows non-empty".** A fork to before the first user message
  hydrates to a (near-)empty branch and MUST still reset; the mock provider's stub fork changes no
  handle, so a dev-daemon fork must leave the timeline alone. Provider-agnostic — no
  `provider === "pi"` check anywhere.
- **Broadcast shape** — passthrough push, following `terminals_update` exactly: sent to **every**
  active session including relay sessions, no subscribe RPC, validated by the
  `sessionMessageBaseSchema` passthrough fallback. Declare a **local TypeScript interface + type
  guard** at the point of use; do **NOT** add a `messages.ts` union member.
- **Response ordering matters:** the RPC response is returned only after the reset and broadcast, so
  the requester can never observe a success response while the daemon still holds the old branch.

## Out of scope

- Any web-client consumption (sprint-072).
- Reusing the broadcast for `/new`, `/resume`, `/clone`, `switch_session` — the `reason` string
  leaves the door open, but wiring them is not this task.

## Acceptance criteria

- [x] A fork that changes the native handle resets the in-memory timeline to the hydrated branch and
      broadcasts `{type: "agent_timeline_reset", agentId, reason: "fork"}` to every active session.
- [x] A fork whose hydration yields **zero** rows still resets and still broadcasts.
- [x] `{cancelled: true}` (extension declined via `session_before_fork`) performs no reset and no
      broadcast.
- [x] A **mock-provider** fork (no handle change) performs no reset and no broadcast — the dev
      daemon's timeline is untouched.
- [x] The success response is observably emitted after the reset+broadcast, not before.

## Test / verification plan

- Build: `npm run build:server` succeeds.
- Tests: extend the `slash-command-operations` tests with four cases — handle-changed (reset +
  broadcast), handle-unchanged/mock (neither), cancelled (neither), empty-rows (still both). Assert
  the broadcast reached a fake session list, and assert ordering (reset observed before the response
  resolves). Run `npx vitest run packages/server/src/agent`.
- Manual: `npm run dev:daemon` (mock provider) + a scripted `agent_fork_request` — confirm the
  timeline is not wiped and no broadcast is emitted.
- Lint/format: `npm run lint`; `npx oxfmt <changed files>`.

## Notes

- TODO(verify) resolved: `persistSessionHandle` returns `Promise<void>` (no returned record), but
  `handleFork` doesn't need it to — `AgentManager.get(agentId)` is an in-memory `Map` lookup, so
  reading `record.persistence?.nativeHandle` once before and once after the call costs nothing
  beyond the lookup itself (no extra disk read, no extra RPC). Implemented exactly as the pure
  guard-detail the spec anticipated.
- Hydration is a synchronous fs read of a small branched JSONL — same cost profile as the existing
  restart-rehydration path, so no async/queueing machinery is warranted.
