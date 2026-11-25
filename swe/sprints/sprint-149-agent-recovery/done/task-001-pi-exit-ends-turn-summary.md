# Task 001 — A Pi process that ends, for any reason, ends its turn and is replaced on the next message — Summary

- **Sprint:** sprints/sprint-149-agent-recovery
- **Completed:** 2026-11-25
- **Status:** done

## What was implemented
`rpc-transport.ts` treats any exit that `close()` did not request (non-zero, signal, unrequested exit 0) as a failure and emits one `error` frame with the exit status and stderr tail. `PiAgentSession.handleProcessExit` ends a running turn with `turn_failed{error}` (between turns it emits no turn event), then calls the `onExit` listeners; `run()` on an already-dead session ends at once with `turn_failed` and writes no prompt. `AgentSession.onExit?(cb)` is a new (optional) contract member, implemented by Pi and by the mock (with a `crash(reason)` test hook). `AgentManager.attachSession` subscribes; `detachDeadSession` sets `managed.session = null` and status `error` (unless `closed`), so the next `send_agent_prompt` goes through `spawnOrResumeSession` and resumes from the persisted handle. `close()` clears the listeners, so archive, delete and shutdown stay silent.

## Files changed
`packages/server/src/agent/providers/pi/{rpc-transport,agent}.ts`, `provider-contract.ts`, `agent-manager.ts`, `providers/mock/mock-provider.ts`; tests `pi-adapter.test.ts`, `transport-errors.test.ts`, `mock-provider.test.ts`, new `agent-recovery.test.ts`; `packages/server/AGENTS.md`.

## Build & test results
```
$ npx vitest run packages/server/src/agent  -> 36 files, 553 passed
$ npm run build:server                       -> success
Full tree after the task: build, typecheck, lint 0 errors; npm test 324 files, 4664 tests passed; oxfmt clean
```

## Acceptance criteria
- [x] SIGKILL mid-turn: `turn_failed` row with the reason, the send RPC resolves, status `error`
- [x] Same for an unrequested exit 0
- [x] The next send spawns a new transport and resumes the same session file
- [x] `close()` (archive, shutdown) produces no `turn_failed`

## Follow-ups / TODO(verify)
- `onExit` is optional in the contract (required would mean editing about 50 cast fakes in tests); a provider that forgets it gets no detach. Only Pi and the mock exist.
- Still open and planned in this sprint: `close()` mid-turn leaves `run()` pending (task-004), request timeouts and SIGKILL after SIGTERM (task-002), a replaced session is not closed (task-004).
