# Task 002 — Every accepted prompt leaves its outcome in the timeline and the status

- **Sprint:** sprints/sprint-151-instant-replies-daemon
- **Status:** backlog
- **Type:** bugfix
- **Area:** packages/server (agent service)
- **Priority:** P1
- **Estimated size:** M
- **Depends on:** none

## Goal
Whatever happens to a prompt after the daemon accepted it, the timeline and the agent's status tell
the whole story, so that task-003 can stop using the RPC's answer to carry the outcome.

## Context / why
Today three outcomes exist only as the RPC's error: Pi cannot be started or resumed, Pi refuses the
prompt before the turn starts (no credential, 403, 429: `session.run` rejects), and the user's message
of such a prompt is never written to the timeline. Once create and send answer at once (task-003) those
errors would be lost. This task records them while the RPCs still block, so it changes nothing for
callers and can be checked on its own.

## Scope references
- `docs/daemon-audit-handoff.md` § "M4 contract" (point 3), § A7
- `packages/server/src/agent/agent-service.ts`: `handleCreate` (:262-370), `handleSendPrompt`
  (:403-428), `runTurn` (:430-565), `ensureSession`, `spawnOrResumeSession`
- `packages/server/src/agent/providers/pi/agent.ts` (`run`, `runSlashPrompt`: disposition `handled`
  produces no `turn_*` events), `providers/mock/mock-provider.ts`, `mock/stream-script.ts`
- Tests: `create-run.test.ts`, `one-turn-at-a-time.test.ts`, `agent-recovery.test.ts`

## What to build
- **The user's message first.** For an accepted prompt the canonical `user_message` row is appended
  and broadcast before the session is spawned or resumed, keyed as today
  (`clientMessageId`, else a new id). A provider that later emits its own `user_message` for the same
  id does not produce a second row.
- **Status `running` from acceptance.** The agent is `running` (and `agent_update running` is
  broadcast) from the moment the claim is taken until the outcome, for send and for create with a
  prompt; no `idle` in between for a create.
- **Failures become rows.** A failed spawn or resume, and a rejected `session.run`, append and
  broadcast one `turn_failed {error}` row (the error's message, capped at 2 KiB) and settle the status
  to `error`. If the provider already emitted a terminal `turn_*` event for this prompt, no second one
  is added.
- **One end signal.** Every accepted prompt ends with exactly one `agent_update` carrying `idle` or
  `error`, including a slash command an extension handles inline (no `turn_*` rows at all). An agent
  closed, archived or deleted mid-turn keeps today's behaviour (no settle; its own notice is the
  signal).
- The RPCs still reject as today in this task.

## Out of scope
Answering at once (task-003). Clients.

## Acceptance criteria
- [ ] A client whose `createSession` or resume rejects: the timeline holds the `user_message`, then
      `turn_failed` with the reason; status `error`; `agent_update` frames `running` then `error`.
- [ ] A session whose `run` rejects: the same, with exactly one `turn_failed`.
- [ ] A session that emits `turn_failed` and then rejects: one `turn_failed` row.
- [ ] A handled slash command: `user_message` row, `agent_update` `running` then `idle`, no `turn_*`.
- [ ] A normal turn is unchanged apart from the earlier `running` (row order pinned by a test).

## Test / verification plan
- `npx vitest run packages/server/src/agent`
- `npm run build:server`

## Notes
After a daemon restart a prompt Pi refused is not in Pi's session file, so its two rows are not rebuilt.
Accepted (same class as the known loss recorded for M3).
