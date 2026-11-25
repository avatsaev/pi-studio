# Task 004 — One Pi process per agent, and no RPC left hanging by a close

- **Sprint:** sprints/sprint-149-agent-recovery
- **Status:** backlog
- **Type:** bugfix
- **Area:** packages/server (agent service, manager, Pi provider)
- **Priority:** P1
- **Estimated size:** M
- **Depends on:** task-002, task-003

## Goal
An agent never has two Pi processes, a failed start leaves none behind, and archiving or deleting a
running agent ends its turn and its RPC.

## Context / why
Findings A3 and A4. `spawnOrResumeSession` has no lock, so concurrent callers (send, list commands,
fork, clone, compact) each spawn Pi; `handleResume` replaces a live session without closing it; a
failure after spawn in `createSession`/`resumeSession` leaves the process running; `close()` clears the
subscribers `run()` waits on, so the create or send RPC never answers. Depends on task-002
(`pi/agent.ts`) and task-003 (`agent-service.ts`, `session-operations.ts`).

## Scope references
- `docs/daemon-audit-handoff.md` § A3, § A4, § Approved improvements (row 2)
- `packages/server/src/agent/agent-service.ts` (`spawnOrResumeSession`, `runTurn`)
- `packages/server/src/agent/session-operations.ts` (`handleResume`)
- `packages/server/src/agent/agent-manager.ts` (`attachSession`, `archiveAgent`, `deleteAgent`)
- `packages/server/src/agent/providers/pi/agent.ts` (`createSession`, `resumeSession`, `close`, `run`)

## What to build
- One in-flight spawn per agent (a memoized promise); later callers await it.
- `attachSession` closes a previous live session before replacing it.
- A spawn whose handshake fails closes its transport before rethrowing.
- `close()` during a turn ends it with `turn_canceled`, so `run()` resolves; archive and delete
  interrupt a running agent first; a `runTurn` continuing after a delete does not throw.

## Acceptance criteria
- [ ] Two concurrent first sends after a restart spawn one process (fake transport factory counts).
- [ ] Resume over a live session: the old transport is closed.
- [ ] Handshake failure: the transport is closed.
- [ ] Archive mid-turn: the send RPC resolves, status `closed`, no error logged from `runTurn`.

## Test / verification plan
- `npx vitest run packages/server/src/agent`
- `npm run build:server`
