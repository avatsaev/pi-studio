# Task 004 — Ephemeral broadcast branch (no `seq`, no `append`) + mock-provider partials

- **Sprint:** sprint-058-tool-output-streaming
- **Status:** backlog
- **Type:** feature
- **Area:** packages/server (agent, providers/mock)
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** task-001

## Goal

Broadcast partial `tool_call` events live **without** appending them to the timeline or assigning a
`seq`, and make the mock provider emit partials so the whole server path is testable offline.

## Context / why

Today the runTurn subscriber appends **every** non-`user_message` event and broadcasts it with the
resulting row's `seq` (`agent-service.ts:318-329`). Partials must not take that path: they are
superseded snapshots, so persisting them would inflate the stored timeline and every fetched page
with rows that carry no information the end event doesn't already have. `projectRows` would collapse
them into the same `tool_call` projected item anyway (`timeline-store.ts:68-116`) — paying storage
and frame cost for data that is discarded at projection time.

`agent_stream.seq` is already optional, so an unpersisted broadcast is expressible today
(verify in task 001).

**`queue_update` joins the same branch.** `timeline-streaming.md` § Timeline model specifies
`queue_update` as an ephemeral live-stream-only signal that "never appears in
`fetch_agent_timeline_request` history and carries no sequence number" — but the code appends it like
everything else. That contradiction was found while scoping this sprint, and the branch this task
introduces is exactly the mechanism the spec assumes. Aligning it here is a one-line addition rather
than leaving a documented invariant contradicted.

Safety of that alignment was verified, not assumed: a user row's `queued` flag is set **only** by
`addOptimisticUserMessage` (the client-local optimistic echo, `reducer.ts:275-292`) and cleared by
`onQueueUpdate`. A history replay never produces a `queued` row, so no replayed `queue_update` is
needed to clear one — its absence from fetched history is inert.

The mock provider is in this task because the persistence assertions need *some* provider that emits
partials, and requiring Pi credentials for that would make the sprint's core test unrunnable in CI.

## Scope references

- `swe/features/tool-output-streaming.md` § Behavior & Algorithms → Server persistence policy,
  § Data & Persistence, § Design tenet 2
- `swe/features/timeline-streaming.md` § Timeline model — the ephemeral/no-`seq` convention
- `packages/server/src/agent/agent-service.ts:291-330` — the runTurn subscriber
- `packages/server/src/agent/timeline-store.ts:181-190` — `append()`
- `packages/server/src/agent/timeline-store.ts:68-116` — `projectRows` (why partials add no value)
- `packages/server/src/agent/providers/mock/mock-provider.ts:131-153` — existing queue/emit style
- Modify: `agent-service.ts`, `mock-provider.ts` (+ tests)

## What to build

**1. Ephemeral branch in the subscriber.** Before the "all other events" path:

```
if (event is tool_call && event.partial) || event.kind === "queue_update":
    broadcast agent_stream { agentId, timestamp: now(), event }   # no seq, no timeline.append
else:
    unchanged: row = timeline.append(event); broadcast with row.seq/row.timestamp
```

Keep the daemon-owned `timestamp` on ephemeral frames — clients must never apply local-clock
heuristics (`timeline-streaming.md` § Timeline model), so the field cannot simply be dropped.

Add a comment naming the two ephemeral kinds and why, so the next event kind added here has a rule to
follow instead of a precedent to guess at.

**2. Mock provider emits partials.** In its shell-tool scenario, emit 2–3 `partial: true` snapshots
with growing accumulated output between the start and end events, mirroring Pi's replace-semantics
(each snapshot contains all prior text). Deterministic — no timers, no simulated latency, following
the existing `queue_update` emission style.

## Out of scope

- The Pi mapper and coalescer (tasks 002–003) — this task is provider-agnostic plumbing.
- Client rendering (task 005).
- Any change to what `projectRows` does with tool-call groups.
- Changing `user_message`'s special-case path.

## Acceptance criteria

- [ ] A turn driven by the mock provider produces timeline rows for the tool call's start and end
      events **only** — no partial rows — while subscribers receive every (coalescer-permitting)
      partial live.
- [ ] Partial broadcasts carry **no** `seq` and **do** carry a daemon-owned `timestamp`.
- [ ] `fetch_agent_timeline_request` after such a turn returns no partial events, and the tool call
      still projects to exactly one `tool_call` item.
- [ ] `queue_update` is no longer appended: after a steered turn, `timeline.allRows()` contains no
      `queue_update`, subscribers still receive it live, and the existing steering tests
      (`session-ops.test.ts`) still pass.
- [ ] Non-partial, non-`queue_update` events are unchanged: `turn-settlement.test.ts`'s exact row-kind
      sequence assertion passes untouched.
- [ ] The persisted agent record on disk contains no partial rows after a streamed turn.

## Test / verification plan

- Build: `npm run build:server` succeeds.
- Typecheck: `npm run typecheck` succeeds.
- Lint/format: `npx oxlint <changed files>`, `npx oxfmt --check <changed files>` clean.
- Tests: extend the agent-service turn tests (alongside `create-run.test.ts` /
  `turn-settlement.test.ts` / `fetch-timeline.test.ts` idioms) and the mock-provider tests; run
  `npx vitest run packages/server/src/agent`.

## Notes

- This task and tasks 002/003 touch disjoint files (`agent-service.ts` + `mock/` vs `pi/`), so they
  may run concurrently after task 001.
- If the `queue_update` alignment turns out to break an assertion not listed above, **stop and
  record it** rather than reverting silently — the spec's `TODO(verify)` exists precisely to be
  closed with an answer either way.
- Resist widening this into a general "ephemeral event registry"; two kinds and a comment is the
  right amount of structure today.
