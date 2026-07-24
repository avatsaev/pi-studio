# Task 003 — Daemon steer/follow-up RPC handlers

- **Sprint:** sprint-039-agent-turn-steering
- **Status:** done
- **Estimated size:** M
- **Depends on:** task-001, task-002

## Goal
Register `steer_agent_request` / `follow_up_agent_request` handlers that inject a message into a
**live** turn by calling the session's `steer`/`followUp` directly — never routing through the
turn loop and never changing agent status — and surface both the injected user text and the
provider's `queue_update` events to clients.

## Background / why
Steering must reach the running session **without** starting a new turn. The existing
`send_agent_prompt` path (`AgentService.runTurn`) blocks on `session.run(...)` until the turn ends
and gates on status transitions (`idle → running`); a second prompt while `running` is illegal.
So steering needs its own handler alongside `interrupt_agent` in `session-operations.ts`, reaching
`managed.session` directly. `queue_update` events emitted by the live provider subscription already
flow through the in-flight `runTurn` subscriber and get broadcast as `agent_stream` events — this
task only adds the injection handler + the optimistic user-text broadcast.

## Scope references
- `packages/server/AGENTS.md` § Session operations, § runTurn / streaming
- `clean-room-scope/features/agent-sessions.md` § Steering (new section — add it), § Other operations
- `clean-room-scope/architecture/agent-lifecycle.md` (status machine — steering is status-neutral)

## What to build
In `packages/server/src/agent/session-operations.ts` (`SessionOperationsService`):
- Register `steer_agent_request` and `follow_up_agent_request`, both dispatching to a shared
  `handleSteer(msg, getSessions, kind: "steer" | "followUp")`.
- `handleSteer`:
  - Resolve `managed = manager.get(agentId)`; if no managed agent or **no live session**, return
    `{ type: <steer|follow_up>_agent_response, agentId, ok: false }` (steering only makes sense on
    a live, running session — no lazy resume like `send`).
  - Pick `managed.session.steer` / `.followUp`; if absent (provider without `supportsSteering`),
    return `ok:false`.
  - **Optimistically** append the injected text as a `user_message` timeline row (reusing the
    in-memory timeline via `getTimeline(agentId)`, keyed by `clientMessageId ?? randomUUID()`) and
    broadcast it as an `agent_stream` event, so history shows what the user asked for even before Pi
    delivers it.
  - `await` the session method; return `{ ..., ok: true }`.
- Register the handlers in **both** `daemon/bootstrap.ts` and `daemon/dev-bootstrap.ts`
  (wherever `SessionOperationsService.registerHandlers` is wired — it already is).

## Out of scope
- Provider/adapter changes (task-002), mock (task-004), SDK/CLI (005/006), web-client (007).
- Any status transition on steer — the agent stays `running`; `runTurn` owns status.

## Acceptance criteria
- [ ] `steer_agent_request` / `follow_up_agent_request` handlers registered and reach the live
  session directly.
- [ ] No live session → `ok:false`; provider lacking the method → `ok:false`.
- [ ] Injected text is appended to the timeline + broadcast as a `user_message` `agent_stream` event.
- [ ] Steering never calls `runTurn`, never changes `lastStatus`.
- [ ] `queue_update` events emitted during the live turn reach clients (already via `runTurn`
  subscriber — verify unchanged).
- [ ] `npm run build:server` + `npm run typecheck` pass.

## Test / verification plan
- Extend `session-ops.test.ts` (mock provider, `turnDelayMs` slow enough to steer mid-turn):
  - `handleSteer(..., "steer")` returns `steer_agent_response` `ok:true` and a `queue_update`
    reflecting the steering queue reaches subscribers.
  - `handleSteer(..., "followUp")` returns `follow_up_agent_response` `ok:true`; follow-up queue
    reflected.
  - Injected text is broadcast as a `user_message` `agent_stream` event.
  - `ok:false` for no live session and for an unknown agent.
- End-to-end smoke (mock, slow turn): create agent, start a turn without awaiting, steer mid-turn,
  confirm the injected `user_message` + `queue_update` broadcast through the live subscriber and the
  turn then completes.
- `npx vitest run packages/server/src/agent/session-ops.test.ts`.

## Notes
- Optimistic broadcast is best-effort (only if a live timeline exists for the turn) — mirrors how
  `runTurn` guarantees exactly one canonical `user_message` per turn without duplicating.
