# Task 002 — Every accepted prompt leaves its outcome in the timeline and the status — Summary

- **Sprint:** sprints/sprint-151-instant-replies-daemon
- **Completed:** 2026-11-25
- **Status:** done

## What was implemented
`AgentService` now splits a turn into `acceptPrompt` (claim, `running` + `agent_update`, the canonical `user_message` row, before any spawn), `startSession` (a failed spawn or resume adds one `turn_failed` row, capped at 2 KiB, and settles `error`) and `executeTurn` (a rejected `session.run` adds `turn_failed` unless the provider already ended the turn; a provider `user_message` with the recorded id is dropped). `settleTurn` sends exactly one `agent_update` `idle` or `error`; a handled slash command ends `running` then `idle` with no `turn_*` rows; a closed, archived or deleted agent is not settled. `AgentManager` allows `initializing -> running`, so a create with a prompt never reads `idle`. The RPCs still block and reject as before (task-003 changes that). `runTurn` stays as a thin wrapper used by tests.

## Files changed
`agent/agent-service.ts`, `agent-manager.ts`, new `prompt-outcome.test.ts`, `create-run.test.ts`, `agent-manager.test.ts`; docs: `packages/server/AGENTS.md`, `README.md`, `docs/gateway-architecture.md`, `docs/rpc-communication.md`.

## Build & test results
```
npx vitest run packages/server/src/agent -> 43 files, 615 passed; six daemon e2e files using initialPrompt -> 165 passed; build:server OK
Wave gate (full tree): build, typecheck 0 errors; lint 0 errors; npm test 331 files, 4750 tests passed
```

## Acceptance criteria
- [x] Spawn/resume rejects: `user_message`, `turn_failed`, status `error`, updates `running` then `error`
- [x] `run` rejects: one `turn_failed`; both-terminal case gives one row
- [x] Handled slash command: `running` then `idle`, no `turn_*`
- [x] Normal turn: frame order pinned for send and create

## Follow-ups / TODO(verify)
- **Interrupt during the start:** `SessionOperationsService.handleInterrupt` sees `running` with no session and settles `idle` while the spawn continues, so two `idle`s follow. Folded into sprint-151/task-003 (the window gets long once the answer is immediate).
- A send to an archived agent now fails at the timeline step with "gone or archived" (nothing started either way).
- After a daemon restart a prompt Pi refused is not in Pi's file, so its rows are not rebuilt (accepted).
