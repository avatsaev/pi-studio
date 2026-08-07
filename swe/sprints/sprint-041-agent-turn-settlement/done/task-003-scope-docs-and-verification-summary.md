# Task 003 — Scope-doc + AGENTS.md sync and full verification — Summary

- **Sprint:** sprint-041-agent-turn-settlement
- **Completed:** 2026-08-03
- **Status:** done

## What was implemented
Synced the settlement-driven turn-terminal semantics (tasks 001–002) into every doc that previously
described the old per-`agent_end` behavior:

1. `clean-room-scope/features/agent-sessions.md` — added a paragraph under Stream events stating the
   terminal event marks the turn's actual end, not a provider's first attempt; names the Pi
   provider concretely (an auto-retried failure, overflow-compaction, or a queued
   steering/follow-up continuation can all resume the same turn — Pi surfaces each such re-run's
   `agent_end` boundary as non-terminal, firing the terminal exactly once at `agent_settled`).
   Annotated the `run(agent, prompt)` pseudo-loop with a one-line comment on the same point.
2. `clean-room-scope/architecture/agent-lifecycle.md` — reworded the Auto-archive bullet: fires
   after the turn's true settlement, exactly once, never on an interim run a provider re-runs
   internally before the turn is actually done.
3. `packages/server/AGENTS.md` — added a bullet under the Pi provider notes (after the existing
   `agent_end`/`stopReason` history bullet) documenting sprint-041: `agent_end` is per-run and never
   terminal; `createPiEventMapper()` is now a stateful factory, one instance per session, that
   latches disposition and only emits the terminal at `agent_settled`; notes the prior bug (early
   `unsubscribe()`/status-flip/`autoArchive` on the first `agent_end`) and that the stateless
   `mapPiEvent` shim remains for single-event assertions only.
4. `packages/server/docs/gateway-architecture.md` — rewrote step 6 (mapper call site →
   `eventMapper.map(raw)`, a per-session `createPiEventMapper()` instance) and step 7 (turn
   completion now keyed to `agent_settled`, with `agent_end`/`willRetry` explained as a per-run,
   non-terminal boundary); updated both mermaid diagrams' mapper node/edge labels (§5's adapter
   flowchart and §8's end-to-end summary) from `mapPiEvent` to `createPiEventMapper()`
   /`eventMapper.map(raw)`; rewrote the §5 event-mapping table's `agent_end`/`agent_settled` rows to
   show the latch-then-emit-on-settle shape; updated the closing "pure event mapper" line to "a
   per-session stateful event mapper" (still accurate: swappable, still deterministic, just no
   longer literally stateless).
5. `packages/server/docs/rpc-communication.md` — rewrote the Hop 3 bullets: `agent_end` is now
   documented as never terminal (latches a disposition from `stopReason`, returns `null`), with
   `agent_settled` as the new bullet emitting the latched terminal.

## Files created / changed
| File | Change |
|------|--------|
| `clean-room-scope/features/agent-sessions.md` | modified — settlement paragraph + pseudo-loop comment |
| `clean-room-scope/architecture/agent-lifecycle.md` | modified — auto-archive bullet reworded |
| `packages/server/AGENTS.md` | modified — new Pi provider bullet (sprint-041) |
| `packages/server/docs/gateway-architecture.md` | modified — steps 6–7 prose, 2 mermaid diagrams, event-mapping table, closing summary line |
| `packages/server/docs/rpc-communication.md` | modified — Hop 3 bullets rewritten |

## How it satisfies the scope
Matches `task-003-scope-docs-and-verification.md` § What to build items 1–5 exactly, each doc's
existing structure/voice preserved (no reformatting of untouched sections), no code changes (this
task is docs + verification only), no aspirational/code-level detail introduced — every added
sentence describes actual, now-shipped behavior from tasks 001–002.

## Build & test results
```
$ npm run build
✓ all packages built (protocol, highlight, relay, client, server, web-client, cli) — no errors

$ npm run typecheck
tsc -b   → success, no errors

$ npm test
Test Files  123 passed (123)
     Tests  1164 passed (1164)

$ npm run lint
(warnings only, all pre-existing in files untouched by this sprint — zero warnings in
 event-mapper.ts, agent.ts, pi-adapter.test.ts, or turn-settlement.test.ts)
```

## Acceptance criteria
- [x] `agent-sessions.md` and `agent-lifecycle.md` describe settlement-driven terminal semantics
      truthfully; no aspirational or code-level detail added.
- [x] `packages/server/AGENTS.md` Pi-provider note updated.
- [x] `packages/server/docs/gateway-architecture.md` and `packages/server/docs/rpc-communication.md`
      no longer state that the turn's terminal event comes from `agent_end`.
- [x] `npm run build`, `npm run typecheck`, and `npm test` all pass.

## Follow-ups / TODO(verify)
- Per this task's own Notes, an optional live-`pi`-binary smoke test (force a transient error to
  trigger a real `willRetry` retry, confirm status stays "running" until settle) was explicitly
  marked nice-to-have, not required — the task-002 regression suite is the sign-off proof. Skipped
  per explicit user direction during this sprint's implementation ("no smoke tests").
- No other deferrals. Sprint-041 is complete: all 3 tasks done, `backlog/` and `in_progress/` empty.
</content>
