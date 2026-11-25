# Task 001 — SDK: `send` resolves on acceptance, and `waitForIdle` — Summary

- **Sprint:** sprints/sprint-152-instant-replies-clients
- **Completed:** 2026-11-25
- **Status:** done

## What was implemented
`AgentHandle.send` resolves `{agentId}` at acceptance (`createAgent` too); the `run` alias is removed (no caller anywhere). New `packages/client/src/agent-wait.ts`: pure decisions `settledStatusOf`, `settledByMessage`, `settledByListing` and `waitForAgentIdle(daemon, agentId, opts)`, exposed as `agent(id).waitForIdle({timeoutMs?, signal?})` resolving `{status: "idle" | "error" | "closed"}`. It subscribes to `agent_update`, `agent_archived`, `agent_deleted` and to state changes first, then reads the status with `list_agents_request`; a settle that arrives during the read wins and the stale read answer is ignored; an agent missing from the listing resolves `closed`. Rejections: `WaitForIdleTimeoutError`, an `AbortError` (an aborted signal sends nothing), `WaitForIdleConnectionClosedError`, and the read's own RPC errors; every listener and timer is removed on every path. The scripted daemon answers `send_agent_prompt` at acceptance, refuses a second send with `busy`, tracks status for `list_agents_request` and can hold a turn (`holdTurns`, `fake.settle`).

## Files changed
New `agent-wait.ts` (+ `agent-wait.test.ts`, 26 tests); `pistudio-client.ts` (+5 tests), `index.ts`, `test-support/scripted-daemon.ts`; docs `packages/client/AGENTS.md` (new section "Create and send answer at acceptance; `waitForIdle`") and `README.md`.

## Build & test results
```
npx vitest run packages/client -> 12 files, 295 passed; npm run build:client OK; tsc -b packages/workbench and desktop/apps/pistudiodesktop OK; oxfmt/oxlint clean
A throwaway test against a real dev daemon (deleted): createAgent with a prompt resolved {agentId}, waitForIdle waited out 50 ms and 400 ms mock turns, a second send was refused with busy, an unknown id resolved closed
```

## Acceptance criteria
- [x] `waitForIdle` on an idle agent resolves at once; `agent_update error` gives `error`; archive or delete gives `closed`
- [x] A settle between the subscription and the status read is not missed
- [x] Timeout and abort reject and remove the listeners
- [x] `send` resolves `{agentId}` against the scripted daemon and a dev daemon

## Follow-ups / TODO(verify)
- The real daemon refuses a busy send with an `RpcError` whose code is `handler_error` and message `busy: agent <id> ...`; match on the message prefix (tasks 002 and 003).
- Archiving a running agent resolves `waitForIdle` as `idle` when the interrupted turn's `agent_update idle` arrives first (the first notice wins; recorded in AGENTS.md).
- Callers outside the package, for later tasks: `Composer.tsx:536` and `composer-busy.ts` (task-003), `packages/cli/src/agent-commands.ts` (task-002).
