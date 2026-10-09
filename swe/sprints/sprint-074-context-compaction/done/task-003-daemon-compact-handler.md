# Task 003 — Daemon: record manual compactions, guard `agent_compact_request`, advertise the flag

- **Sprint:** sprint-074-context-compaction
- **Status:** done
- **Type:** feature
- **Area:** packages/server (agent/, daemon bootstraps)
- **Priority:** P1
- **Estimated size:** M
- **Depends on:** task-002

## Goal

Manual compactions produce timeline rows and `agent_stream` broadcasts like any other event.
`agent_compact_request` refuses to run on a running agent or alongside another compaction, works on
a session whose process has not been resumed yet, and never leaves a `started` row without a
terminal row.

## Context / why

The daemon records and broadcasts stream events **only** while `AgentService.runTurn` holds a
`session.subscribe` (`agent-service.ts:327-375`). The Pi adapter's `transport.onEvent` is always on,
but `emit` only reaches subscribers, and `handleCompact` subscribes to nothing. So task-002's mapped
events would be dropped for manual compactions (G2). Automatic compactions already happen inside a
turn's window and need nothing here beyond a regression test.

Guard rationale (G3): Pi's `compact()` starts with `abort()`, so compacting mid-turn kills the run,
and a second concurrent `compact` cancels the first. Resume rationale: after a daemon restart, no
process is attached until something resumes it. Compacting an old, oversized session before
continuing it is a primary use case, so `has no live session` is the wrong answer.

## Scope references

- `swe/features/context-compaction.md` § Public contract › Server, § Behavior & algorithms (daemon
  pseudocode), § Error handling & edge cases
- `packages/server/src/agent/slash-command-operations.ts:24-42` (deps, `requireSession`,
  `unsupported`), `:117-130` (`handleCompact`), `:205-222` (`handleFork`, which already imports
  from `agent-service.ts`)
- `packages/server/src/agent/agent-service.ts:39-84` (module-level timeline map,
  `getOrCreateTimeline`, `getTimeline`, `seedTimeline`, `resetTimeline`), `:99` (`spawnOrResumeSession`),
  `:312-375` (`runTurn`'s append + broadcast), `:409-414` (final-status derivation)
- `packages/server/src/agent/timeline-rpc.ts:32-41` — the seed-if-absent fallback this task
  extracts
- Tests: `packages/server/src/agent/slash-command-ops.test.ts`, `agent-service.test.ts`,
  `timeline-rpc.test.ts`, `turn-settlement.test.ts` (fake-session shapes)

## What to build

**Shared helpers in `agent-service.ts` (module level, next to `seedTimeline`/`resetTimeline`).**
- `appendStreamEvent(agentId, event, broadcast, sessions)`: `getOrCreateTimeline(agentId).append(event)`,
  then broadcast the exact `{type:"session", message:{type:"agent_stream", agentId, seq, timestamp,
  event}}` envelope `runTurn` sends today. `runTurn`'s "all other events" branch must call it, so
  there is one implementation (the special-cased `user_message` branch may stay as is).
- `ensureTimelineSeeded(agentId, manager, resolveClient)`: the `timeline-rpc.ts:32-41` logic (no
  store → hydrate from the record's persistence handle → `seedTimeline` when rows exist), and
  `timeline-rpc.ts` calls it instead of its inline copy.

**`handleCompact` (follow the spec pseudocode).**
1. Unknown agent → the existing `unknown agent` error.
2. `record.lastStatus === "running"` → throw `busy`: `agent <id> is running; wait for the turn to
   finish before compacting`.
3. Agent already in the module-local `compactionsInFlight: Set<string>` → throw `busy`:
   `agent <id> is already compacting`.
4. Add to the set, and release it in a `finally` that covers **every** later step, including
   resume and unsupported failures.
5. `session = managed.session ?? await spawnOrResumeSession(this.deps, agentId)`, then the existing
   `unsupported` check.
6. `ensureTimelineSeeded(...)` **before** subscribing, so the first compaction row cannot create an
   empty store that blocks history hydration.
7. Subscribe. Forward only `kind === "compaction"` events through `appendStreamEvent`, tracking the
   open id and whether a terminal phase was seen. `await session.compact(customInstructions)`.
   Unsubscribe in a `finally`.
8. On rejection with an open id and no terminal seen → `appendStreamEvent` a synthetic
   `{kind:"compaction", compactionId: openId, phase:"failed", error}`, then rethrow.
9. Keep `broadcastAgentUpdate(..., {compacted:true})` and return the payload (now carrying
   `estimatedTokensAfter` from Pi).

Errors keep using the router's `rpc_error` path (plain `Error` throws like `requireSession`). The
`busy` wording above is the contract the web UI shows inline. Do not change agent status anywhere in
this handler.

**Feature flag.** Confirm `compactionEvents` reaches `server_info.features` on both the direct WS
path (`ws-server.ts` `defaultFeatures()`) and the relay path (`bootstrap.ts`), which advertise
`SERVER_FEATURES` wholesale. Fix it only if it doesn't.

**Docs.** `packages/server/AGENTS.md`: `handleCompact`'s guards, the resume, the subscription
window and the synthetic terminal; the two new `agent-service.ts` helpers in the source-layout
notes; the invariant "stream events outside a turn are recorded only by an operation that
explicitly subscribes (today: compaction)".

## Out of scope

- Forwarding any non-compaction event emitted outside a turn.
- Queueing a compaction until a turn ends.
- CLI changes (task-004).

## Acceptance criteria

- [x] Compacting an idle agent appends `started` and `completed` rows to its timeline and
      broadcasts both as `agent_stream` to **every** active session, with daemon seq/timestamp.
- [x] `agent_compact_request` on a running agent rejects with the `busy` message and never calls
      `session.compact`.
- [x] A second request while one is in flight rejects with `busy`, and the first completes
      normally. The set is released after success, failure, unsupported, and resume failure.
- [x] A record with no live session is resumed and compacted, and an agent with no in-memory store
      is seeded from hydration before the compaction rows are appended (fetching its timeline
      afterwards returns history followed by the compaction rows).
- [x] A provider that rejects after emitting `started` and nothing else produces a synthetic
      `failed` row with the same id. A provider that emitted its own `failed` gets no duplicate.
- [x] Regression: a fake session emitting `compaction` events (including `failed`) **during a turn**
      gets them recorded by `runTurn`, and the agent still ends `idle`, not `error`.
- [x] `timeline-rpc` behavior is unchanged after switching to `ensureTimelineSeeded`
      (`timeline-rpc.test.ts` green).

## Test / verification plan

- Tests: `slash-command-ops.test.ts` (guards, set release on every path, synthetic terminal, resume
  path, broadcast to two fake sessions); `agent-service.test.ts` or `turn-settlement.test.ts` for
  the in-turn regression.
- Run: `npx vitest run packages/server` and `npm run build:server`.
- Manual: `npm run dev:daemon`, create a mock agent, send `agent_compact_request` from a script or
  the CLI (`node packages/cli/dist/... agent compact <id>`), and observe two `agent_stream`
  `compaction` frames about 1.5 s apart.

## Notes

- `spawnOrResumeSession` takes `{manager, resolveClient, logger}`, all already in
  `SlashCommandOpsDeps`.
- This changes CLI-visible behavior on purpose: `pi-studio agent compact` on a running agent now
  errors instead of stopping the turn. Record it in the CLI section of the sprint-close docs.
