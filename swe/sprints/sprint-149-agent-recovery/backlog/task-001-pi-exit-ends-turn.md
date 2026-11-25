# Task 001 — A Pi process that ends, for any reason, ends its turn and is replaced on the next message

- **Sprint:** sprints/sprint-149-agent-recovery
- **Status:** backlog
- **Type:** bugfix
- **Area:** packages/server (agent: Pi provider, manager, service)
- **Priority:** P1
- **Estimated size:** M
- **Depends on:** sprint-147/task-006

## Goal
When Pi dies during or between turns, the running turn ends as failed with the exit reason, and the
next message starts a fresh Pi on the same conversation, without restarting the daemon.

## Context / why
Finding A1, partly fixed in `601a91e6` (sprint 142 era): a non-zero exit now fails the transport, and
a turn waiting on a dead process ends with an `error` row. Still broken:
- An exit by signal (`code === null`, e.g. SIGKILL from the OOM killer) or an unrequested exit 0 does
  not fail the transport (`rpc-transport.ts` `exit` handler), so the turn still hangs.
- The turn ends with a non-terminal `error` event, not `turn_failed`.
- `managed.session` is never cleared, so every later message ends at once with the old error until the
  daemon restarts.
Depends on sprint-147/task-006, the last sprint-147 edit of `pi/agent.ts`.

## Scope references
- `docs/daemon-audit-handoff.md` § A1, § Approved improvements (row 2)
- `packages/server/src/agent/providers/pi/rpc-transport.ts` (`exit` handler, `failAll`, `closing`)
- `packages/server/src/agent/providers/pi/agent.ts` (`processFailure`, `run`)
- `packages/server/src/agent/agent-manager.ts` (`attachSession`, `managed.session`)
- `packages/server/src/agent/agent-service.ts` (`runTurn`, `spawnOrResumeSession`)
- `packages/server/src/agent/provider-contract.ts` (if the session needs a "dead" signal)

## What to build
- Transport: any exit not caused by `close()` fails it with the exit status and stderr tail.
- Session: on transport failure, emit `turn_failed` (with the message) for a turn in progress, and
  report itself dead (a contract member such as `onExit(cb)` or `isAlive()`, implemented by Pi and the
  mock).
- Manager/service: a dead session is detached (`managed.session = null`, status `error`), so the next
  `send_agent_prompt` goes through `spawnOrResumeSession` and resumes from the persisted session handle.

## Acceptance criteria
- [ ] Fake transport: SIGKILL mid-turn → `turn_failed` row with the reason; the send RPC resolves;
      status `error`.
- [ ] Same for an unrequested exit 0.
- [ ] The next send spawns a new transport and resumes the same session file.
- [ ] `close()` (archive, shutdown) does not produce a `turn_failed`.

## Test / verification plan
- `npx vitest run packages/server/src/agent`
- `npm run build:server`
