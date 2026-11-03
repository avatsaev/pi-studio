# Task 004 — Ephemeral broadcast branch (no `seq`, no `append`) + mock-provider `#tool` scenario

- **Sprint:** sprint-058-tool-output-streaming
- **Status:** done
- **Type:** feature
- **Area:** packages/server (agent, providers/mock)
- **Priority:** P1
- **Estimated size:** M (was S — the mock scenario now has to be created, not extended)
- **Depends on:** task-001
- **Spec re-baselined:** 2026-11-03 against the current tree

## Goal

Broadcast partial `tool_call` events live **without** appending them to the timeline or assigning a
`seq`, align `queue_update` with its spec'd ephemeral status through the same branch, and give the
mock provider a scripted tool-call scenario that emits partials so the whole server path is testable
offline.

## Context / why

Today every non-`user_message` event from `runTurn`'s subscriber goes through the exported helper
`appendStreamEvent` (`agent-service.ts` ≈ L91–108; called from the subscriber at ≈ L399 under the
comment "All other events: append + broadcast"). The helper does
`getOrCreateTimeline(agentId).append(event)` and broadcasts `agent_stream` with
`seq: row.seq, timestamp: row.timestamp`. It has a second caller, `slash-command-operations.ts`
(≈ L193, L202), for `compaction` events recorded outside a turn (sprint-074).

Partials must not take that path: they are superseded snapshots, so persisting them would inflate
the stored timeline and every fetched page with rows that carry no information the end event
doesn't already have. `projectRows` (`timeline-store.ts` ≈ L73–93) would collapse them into the
same `tool_call` projected item anyway — paying storage and frame cost for data discarded at
projection time.

`agent_stream.seq` is already optional (`messages.ts:338`), so an unpersisted broadcast is
expressible today — there is simply **no site that builds a seq-less `agent_stream` frame yet**
(the four construction sites — `agent-service.ts` ≈ L101, L387, L415; `session-operations.ts`
≈ L127 — all take `seq`/`timestamp` from a row). Note the sprint-079 `agent_todos_update` family
is **not** a precedent for this: its `seq` is a per-agent counter on a different message type, not
a seq-less `agent_stream`.

**`queue_update` joins the same branch.** `timeline-streaming.md` § Timeline model (≈ L37–40)
specifies `queue_update` as live-stream-only, "never appears in `fetch_agent_timeline_request`
history and carries no sequence number" — but the code still appends it like everything else
(verified 2026-11-03: it flows through `appendStreamEvent` with a `seq`). The branch this task
introduces is exactly the mechanism the spec assumes; aligning it here is a one-line addition rather
than leaving a documented invariant contradicted.

Safety of that alignment was verified, not assumed: a user row's `queued` flag is set **only** by
`addOptimisticUserMessage` (the client-local optimistic echo, `reducer.ts` ≈ L395–413,
`row-model.ts` ≈ L46) and cleared only by `onQueueUpdate` (≈ L333–341). A history replay never
produces a `queued` row, so no replayed `queue_update` is needed to clear one — its absence from
fetched history is inert. The steering tests in `session-ops.test.ts` (≈ L513–550) subscribe
directly to `managed.session`, not the timeline, so they are unaffected.

**The mock provider has no tool-call scenario at all.** `grep tool_call|callId` over
`providers/mock/` returns nothing; it emits only `turn_started`, `assistant_message`,
`turn_completed`, `turn_canceled`, `compaction` and `queue_update`. The original draft assumed a
"shell-tool scenario" to extend — it must be **created**. It is in this task because the
persistence assertions need *some* provider that emits partials, and requiring Pi credentials for
that would make the sprint's core test unrunnable in CI.

The mock's own `emit()` (`mock-provider.ts` ≈ L136–139) pushes every event into `this.history`,
replayed by `streamHistory()` (≈ L146–148), exactly like the Pi session. A mock partial sent
through `emit` would therefore be replayed as history, violating tenet 2 for the one provider the
tests use. The mock does not get the Pi coalescer, but it does need the history exclusion.

## Scope references

- `swe/features/tool-output-streaming.md` § Behavior & Algorithms → Server persistence policy,
  § Data & Persistence, § Design tenet 2
- `swe/features/timeline-streaming.md` § Timeline model — the ephemeral/no-`seq` convention
- `packages/server/src/agent/agent-service.ts` ≈ L91–108 — `appendStreamEvent`
- `packages/server/src/agent/agent-service.ts` ≈ L371–400 — the runTurn subscriber
- `packages/server/src/agent/slash-command-operations.ts` ≈ L193, L202 — the second caller
- `packages/server/src/agent/timeline-store.ts` ≈ L187–198 — `append()`; ≈ L73–93 —
  `projectRows` tool grouping
- `packages/server/src/agent/providers/mock/mock-provider.ts` ≈ L136–148 — `emit`/`history`/
  `streamHistory`; ≈ L177–230 — the `#ui ...` / `#todo ...` prompt-recipe precedents
  (`startUiScriptTurn`, the `#todo` turn, `todo-script.ts`); ≈ L325–346 — `steer`/`followUp`
  `queue_update` emission
- Modify: `agent-service.ts`, `mock-provider.ts` (+ a `tool-script.ts` recipe module if it mirrors
  `todo-script.ts`), tests

## What to build

**1. Ephemeral branch.** Put it **inside `appendStreamEvent`** (rename is optional; if renamed,
update both callers), so every append-and-broadcast path shares one rule:

```
if (event.kind === "tool_call" && event.partial) || event.kind === "queue_update":
    broadcast agent_stream { agentId, timestamp: now-ISO, event }   # no seq, no timeline.append
else:
    unchanged: row = timeline.append(event); broadcast with row.seq/row.timestamp
```

Keep the daemon-owned `timestamp` on ephemeral frames — clients must never apply local-clock
heuristics (`timeline-streaming.md` § Timeline model), so the field cannot simply be dropped. Use
the same timestamp source `AgentTimelineStore.append` uses so formats match.

Add a comment naming the two ephemeral kinds and why, so the next event kind added here has a rule
to follow instead of a precedent to guess at. Resist widening this into an "ephemeral event
registry"; two kinds and a comment is the right amount of structure.

**2. Mock provider `#tool` scenario.** Following the `#ui …` / `#todo …` prompt-recipe convention:
a prompt starting with `#tool` runs a scripted shell tool call instead of the normal echoed turn —

- `tool_call` `{ callId, status: "running", tool: { kind: "shell", command } }` (start row)
- 3 `tool_call` `{ callId, status: "running", partial: true, tool: { kind: "shell", command,
  output } }` with **growing accumulated** output (each snapshot contains all prior text —
  mirrors bash's replace-semantics)
- `tool_call` `{ callId, status: "completed", tool: { kind: "shell", command, output: <final> } }`
- then the usual assistant echo + `turn_completed`.

Deterministic — no timers between the tool events, no simulated latency beyond the existing
`turnDelayMs` turn pacing. `#tool help` lists the recipe like `#ui help`/`#todo help` do. Keep the
recipe table small; one `shell` recipe plus `help` is enough. A second recipe that ends with an
**empty** final output (`#tool empty`) is worth adding — task 005's terminal-output-authority rule
and task 007's convergence test need exactly that edge.

**3. Mock history exclusion.** Partials must be delivered to subscribers but **not** pushed into the
mock's `history`. Either an `emitEphemeral()` sibling of `emit()` or a `partial` check inside `emit`
— pick one and comment it as the mirror of the Pi coalescer's history rule.

## Out of scope

- The Pi mapper and coalescer (tasks 002–003) — this task is provider-agnostic plumbing.
- Client rendering (task 005).
- Any change to what `projectRows` does with tool-call groups.
- Changing `user_message`'s special-case path (≈ L373–396, L403–422).
- Throttling in the mock.

## Acceptance criteria

- [ ] A `#tool` turn driven by the mock provider leaves `timeline.allRows()` with the tool call's
      start and end rows **only** — no partial rows — while subscribers receive all 3 partials live.
- [ ] Partial broadcasts carry **no** `seq` and **do** carry a daemon-owned `timestamp`.
- [ ] `fetch_agent_timeline_request` after such a turn returns no partial events, and the tool call
      still projects to exactly one `tool_call` item.
- [ ] The mock's `streamHistory()` after a `#tool` turn yields no `partial: true` event and still
      yields the start and end events (so a post-restart hydration contains no partials).
- [ ] `queue_update` is no longer appended: after a steered turn, `timeline.allRows()` contains no
      `queue_update`, subscribers still receive it live, and the existing steering tests
      (`session-ops.test.ts`) still pass.
- [ ] Non-partial, non-`queue_update` events are unchanged: `turn-settlement.test.ts`'s exact
      row-kind sequence assertion (≈ L176–179) passes untouched; `compact-handler.test.ts`'s
      compaction-row expectations (≈ L216–218) pass untouched, proving the second caller is intact.
- [ ] `#tool help` answers with the recipe list and emits no tool events.

## Test / verification plan

- Build: `npm run build:server` succeeds.
- Typecheck: `npm run typecheck` succeeds.
- Lint/format: `npx oxlint <changed files>`, `npx oxfmt --check <changed files>` clean.
- Tests: extend the agent-service turn tests (alongside `create-run.test.ts` ≈ L83 /
  `turn-settlement.test.ts` ≈ L175–187 / `fetch-timeline.test.ts` ≈ L99–101 idioms) and the
  mock-provider tests; run `npx vitest run packages/server/src/agent`.

## Notes

- The original draft had an acceptance criterion "the persisted agent record on disk contains no
  partial rows". It is vacuous: `AgentRecord.timeline` (`entity-schemas.ts` ≈ L103) is `[]` at
  create and nothing writes `allRows()` into it — the timeline store is in-memory, seeded from
  provider history on hydration. The `streamHistory()` criterion above is the real restart-safety
  guarantee.
- This task and tasks 002/003 touch disjoint files (`agent-service.ts` + `mock/` vs `pi/`), so they
  may run concurrently after task 001.
- If the `queue_update` alignment turns out to break an assertion not listed above, **stop and
  record it** rather than reverting silently — the spec's `TODO(verify)` exists precisely to be
  closed with an answer either way.
- `packages/server/AGENTS.md`'s mock-provider recipe list (`#ui`, `#todo`) gains `#tool` in task
  007's sweep, not here.
