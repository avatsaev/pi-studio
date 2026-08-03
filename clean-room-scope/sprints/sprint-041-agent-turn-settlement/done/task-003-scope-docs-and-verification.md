# Task 003 — Scope-doc + AGENTS.md sync and full verification

- **Sprint:** sprint-041-agent-turn-settlement
- **Status:** done
- **Estimated size:** S
- **Depends on:** task-001, task-002

## Goal
Record the settlement semantics in the clean-room scope docs and the affected `AGENTS.md`, then run
the full build/typecheck/test gate.

## Background / why
The scope docs currently describe the turn lifecycle without the retry/settlement nuance, and
`sprint-040/task-001` explicitly flagged `agent_settled`/`willRetry` as a known, deferred audit gap.
Now that the gap is closed, the specs must state the real behavior: `agent_end` is a per-run boundary;
the terminal turn event is derived from `agent_settled` (with disposition from the settled run's
`stopReason`). Docs are a same-change deliverable per the repo's docs-sync rule.

## Scope references
- `clean-room-scope/features/agent-sessions.md` (§ Stream events / the `runTurn` pseudo-loop
  `:93-97` — clarify that terminal is emitted at Pi `agent_settled`, not per `agent_end`)
- `clean-room-scope/architecture/agent-lifecycle.md` (§ auto-archive `:69-72` — note terminal =
  settlement, so auto-archive/idle happen once at settle, not on an interim retried run)
- `packages/server/AGENTS.md` (§ Agent provider model — add that the Pi adapter maps `agent_end`
  (non-terminal, honouring `willRetry`) + `agent_settled` (terminal) → the turn-closer stream event)
- `packages/server/docs/gateway-architecture.md` (§ Step-by-step item 7 `:263-265` asserts "When
  `agent_end` (→ `turn_completed`) is seen, the `run()` promise resolves" — false after task-001;
  also the `mapPiEvent` prose `:259-262` and the two mermaid mapper nodes `:311-322` / `:440-441`)
- `packages/server/docs/rpc-communication.md` (Hop 3 mapping bullets `:223-224` — `agent_end` →
  terminal by `stopReason`, plus the `null`-returning ignore list)
- `clean-room-scope/sprints/sprint-040-agent-command-discovery/backlog/task-001-protocol-schemas.md`
  (the "deferred audit gaps" note — leave as-is; this sprint is the closure, no edit required)

## What to build
1. `agent-sessions.md` — in the Stream-events / `runTurn` description, state that the Pi provider
   emits the terminal turn event (`turn_completed`/`turn_failed`/`turn_canceled`) on `agent_settled`,
   and that a non-final `agent_end` (retry / overflow-compaction / queued continuation) is not
   terminal. Keep it behavioral (WHAT), no source code.
2. `agent-lifecycle.md` — clarify the auto-archive/idle note: the "first terminal turn event" is the
   settlement, so status→idle and auto-archive fire once at settle, never on an interim retried run.
3. `packages/server/AGENTS.md` — one line under the Pi provider notes: `agent_end` is per-run
   (honours `willRetry`), `agent_settled` is the terminal signal that drives the turn-closer event.
4. `packages/server/docs/gateway-architecture.md` — rewrite Step-by-step item 7 so the turn
   completes at `agent_settled`, noting that an `agent_end` with `willRetry` (or with further runs to
   come) is a per-run boundary and non-terminal; update the `mapPiEvent` prose and both mermaid
   mapper node labels to the stateful `createPiEventMapper()`.
5. `packages/server/docs/rpc-communication.md` — Hop 3: split the `agent_end` bullet into
   `agent_end` (per-run; latches the disposition from `stopReason`; returns `null`) and
   `agent_settled` (emits the latched terminal).
6. Run the full gate.

## Out of scope
- Any code change (tasks 001–002). SDK/CLI/UI surfaces (unaffected — same terminal kinds).

## Acceptance criteria
- [ ] `agent-sessions.md` and `agent-lifecycle.md` describe settlement-driven terminal semantics
      truthfully; no aspirational or code-level detail added.
- [ ] `packages/server/AGENTS.md` Pi-provider note updated.
- [ ] `packages/server/docs/gateway-architecture.md` and `packages/server/docs/rpc-communication.md`
      no longer state that the turn's terminal event comes from `agent_end`.
- [ ] `npm run build`, `npm run typecheck`, and `npm test` (or at minimum
      `npx vitest run packages/server packages/protocol`) pass.

## Test / verification plan
- Docs are prose — verify by re-reading against the task-001/002 behavior; no test.
- Full check: `npm run build` + `npm run typecheck` + `npm test`.

## Notes
- Match each doc's existing structure/voice; do not reformat sections you are not touching.
- If a live `pi` binary is available, an optional smoke (force a transient error to trigger a real
  `willRetry` retry, confirm the UI/status stays "running" until settle) is nice-to-have but not
  required — the task-002 regression is the sign-off proof.
