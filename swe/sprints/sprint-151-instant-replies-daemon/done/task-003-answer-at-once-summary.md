# Task 003 — Create and send answer as soon as the request is accepted — Summary

- **Sprint:** sprints/sprint-151-instant-replies-daemon
- **Completed:** 2026-11-25
- **Status:** done

## What was implemented
`handleCreate` (eager path) and `handleSendPrompt` validate, take the turn claim, run `acceptPrompt`, then answer `create_agent_response` / `agent_prompt_response` with `{payload: {agentId}}`. Everything after the answer runs in the router's `afterReply` hook through `runAccepted` (never rejects): `beginTurn` (the `agent_update running` and the `user_message` row), `startSession`, `executeTurn`. A refusal (`busy`, unknown agent, invalid prompt) is an `rpc_error` and starts nothing. `AgentManager.claim(id, kind)` takes the claim synchronously and returns an idempotent release (`runExclusive` is built on it); the claim is held from acceptance until the settle. `AgentService.turnSettled(agentId)` is the seam for tests. An interrupt during the start ends the turn as one `turn_canceled` row and one `idle` (`cancelPendingStart`); `handleInterrupt`'s self-heal runs only when no turn is in flight. `runTurn` (no production caller) is removed.

## Files changed
`agent/agent-manager.ts`, `agent-service.ts`, `session-operations.ts`, `slash-command-operations.ts` (comment); new `answer-at-once.test.ts` (12 tests through the real router), `test-support/answer-then-run.ts`, `test-support/wire-answers.ts`; about 16 agent tests ported; daemon e2e (`bootstrap.test.ts` with `waitForAgentIdle`, `agent-todos-e2e`, `agent-ui-e2e`, `mock-stream-producers-e2e`, `test-support/external-fixtures-scenario.ts`) and two CLI e2e tests ported; docs: `packages/server/AGENTS.md`, `docs/gateway-architecture.md`, `docs/rpc-communication.md`, root `AGENTS.md` (one mention).

## Build & test results
```
npx vitest run packages/server packages/cli packages/client -> all in-scope tests pass; build:server and build:cli OK; oxfmt/oxlint clean on 30 files
Interim full-tree gate: npm run build, typecheck 0 errors; lint 0 errors; npm test 338 files, 4847 tests passed
```

## Acceptance criteria
- [x] Answer before the turn's first frame and while it runs (create and send)
- [x] A second send: `busy`, no rows added
- [x] A socket that closes right after the answer: the turn completes
- [x] Pi cannot start after acceptance: success answer, then `turn_failed` and `agent_update error`
- [x] No `unhandledRejection`
- [x] Interrupt during start: one `turn_canceled`, one `idle`, the next send is accepted
- [x] `autoArchive` and the deferred draft unchanged

## Follow-ups / TODO(verify)
- The CLI `run` / `send` now return at acceptance, and the workbench composer has a window where a second send gets `busy`: both closed by sprint-152.
- **Known gap:** the eager-create spawn does not check whether the agent was archived while it spawned, so an archive during the spawn can attach a session to an archived agent (as before this task, but the window is now what the client sees). Not fixed.
- Nothing was run against a real Pi or the relay transport (sprint-152/task-005 does).
