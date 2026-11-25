# Task 004 — One Pi process per agent, and no RPC left hanging by a close — Summary

- **Sprint:** sprints/sprint-149-agent-recovery
- **Completed:** 2026-11-25
- **Status:** done

## What was implemented
`AgentManager.spawnOnce(id, fn)` memoizes one in-flight spawn per agent; a new `ensureSession(deps, agentId)` returns the attached session or spawns one, and send, compact, fork, clone, `handleListCommands`, `handleForkMessages` and `handleCreate`'s eager path all use it (`handleResume` still forces a fresh process). `attachSession` closes the session it replaces. A spawn whose handshake (`switch_session`) or model/thinking replay fails closes its transport, and a spawn that finds the agent archived or deleted meanwhile closes the process and throws. `PiAgentSession.close()` (and the mock's) ends a running turn with `turn_canceled`, so `run()` resolves; a slash prompt whose ack is rejected by the close is not a failure. Archive and delete interrupt a running turn first; `deleteAgent` removes the agent from memory before closing, and a failing close is logged, not thrown; `runTurn` returns quietly (an info log) when the agent is closed or gone. `AGENT_CLOSE_TIMEOUT_MS = PI_KILL_GRACE_MS + 2000` (7 s), derived from the transport's exported constant, so a Pi ignoring SIGTERM is SIGKILLed before shutdown gives up.

## Files changed
`agent-manager.ts`, `agent-service.ts`, `slash-command-operations.ts`, `provider-contract.ts`, `providers/pi/agent.ts`, `providers/mock/mock-provider.ts`; new `one-process-per-agent.test.ts` (11 tests over a fake transport factory that counts spawns); updated `agent-manager.test.ts`, `pi-adapter.test.ts`; `packages/server/AGENTS.md`, `README.md`.

## Build & test results
```
$ npx vitest run packages/server   -> 115 files, 1617 passed
$ npm run build:server             -> success
Full tree: build, typecheck, lint 0 errors; npm test 327 files, 4693 tests passed (two runs); oxfmt clean
```

## Acceptance criteria
- [x] Concurrent first sends after a restart spawn one process (the second is refused `busy`; a send racing `ensureSession` also gives one process)
- [x] Resume over a live session closes the old transport
- [x] Handshake failure closes the transport; a later call spawns again
- [x] Archive mid-turn: the send RPC resolves, status `closed`, last timeline row `turn_canceled`, no error logged from `runTurn`; delete mid-turn also resolves and writes nothing back

## Follow-ups / TODO(verify)
- Shutdown (`closeAll`) now ends a running turn as `turn_canceled`, and `runTurn` then writes status `idle` before the daemon exits.
- `AgentManager` imports `PI_KILL_GRACE_MS` from the Pi transport (inside `agent/`, so the provider-isolation rule holds).
