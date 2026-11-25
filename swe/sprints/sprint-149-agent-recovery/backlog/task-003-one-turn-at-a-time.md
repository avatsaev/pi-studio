# Task 003 — One turn at a time per agent

- **Sprint:** sprints/sprint-149-agent-recovery
- **Status:** backlog
- **Type:** bugfix
- **Area:** packages/server (agent service, session and slash-command operations)
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** task-001, sprint-148/task-001

## Goal
A second message while an agent is running or compacting is refused cleanly instead of starting a
second turn that doubles every reply.

## Context / why
Findings A2 and A9. `handleSendPrompt` never checks the status, so two sends start two `runTurn`s with
two subscriptions. The workbench sends only when idle and steers while running (`Composer.tsx`,
checked), so refusing is safe for it. Compact already refuses with `busy`; this task uses the same
shape. Depends on task-001 (`agent-service.ts`) and sprint-148/task-001 (`session-operations.ts`).

## Scope references
- `docs/daemon-audit-handoff.md` § A2, § A9, § Approved improvements (row 2)
- `packages/server/src/agent/agent-service.ts` (`handleSendPrompt`, `runTurn`)
- `packages/server/src/agent/session-operations.ts` (`handleUpdate`, resume)
- `packages/server/src/agent/slash-command-operations.ts` (compact's `busy`, new session, switch, fork,
  clone)

## What to build
- A per-agent busy state covering a running turn and a compaction. `send_agent_prompt` while busy
  throws `busy: agent <id> is running` (the router turns it into `rpc_error`, as compact does).
- New session, switch, fork and clone refused the same way while busy. Model and thinking-level
  changes stay allowed (Pi applies them to the next turn).
- `handleUpdate`: re-read the record after its awaits before writing, so a concurrent model or
  thinking change is not overwritten.
- CLI `agent send` prints the busy message; the workbench shows the `rpc_error` if a race ever
  produces one (check the existing error path, no new UI).

## Acceptance criteria
- [ ] Two concurrent sends: one turn runs, the other gets `busy`; each event is broadcast once.
- [ ] A send during a compaction gets `busy`.
- [ ] Fork while running gets `busy`.

## Test / verification plan
- `npx vitest run packages/server/src/agent`
- `npm run build:server`
