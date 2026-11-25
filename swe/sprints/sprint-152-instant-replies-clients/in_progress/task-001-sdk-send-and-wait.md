# Task 001 — SDK: `send` resolves on acceptance, and `waitForIdle`

- **Sprint:** sprints/sprint-152-instant-replies-clients
- **Status:** in_progress
- **Type:** feature
- **Area:** packages/client
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** sprint-151/task-003

## Goal
The SDK says what the daemon now does, and gives every client one way to wait for an agent to finish.

## Context / why
After sprint 151 the answers to create and send mean "accepted". `AgentHandle.send` returns
`Promise<unknown>` (the raw message), `AgentHandle.run` is an alias of it, and there is no helper to
wait for a turn. The CLI (task-002) needs one.

## Scope references
- `docs/daemon-audit-handoff.md` § "M4 contract" (points 3 to 5)
- `packages/client/src/pistudio-client.ts` (`createAgent` :572-579, `AgentHandle.send` :1253-1262,
  `run` :1264, `onAgentUpdate` :629, the archive/delete notices near :535)
- `packages/client/src/daemon-client.ts` (`request` :205-229, `handleClose` :297-309)
- `packages/client/src/test-support/scripted-daemon.ts` (:91-107), `pistudio-client.test.ts`
- `packages/client/AGENTS.md` (:229, :299, :378-379, :607)

## What to build
- `AgentHandle.send(prompt, opts)` returns `Promise<{agentId: string}>`. Delete the `run` alias after
  checking its references (lsp).
- `agent(id).waitForIdle({timeoutMs?, signal?})` resolves `{status: "idle" | "error" | "closed"}`:
  it subscribes to `agent_update` and to the archive and delete notices first, then reads the agent's
  current status, and resolves at once when the agent is not `running` or `initializing`. It rejects on
  timeout (a typed error), on abort, and when the connection closes. The decision logic is a pure
  function with its own tests.
- The scripted daemon answers `send_agent_prompt` and pushes `running` then a settle.
- `packages/client/AGENTS.md`: the contract, `waitForIdle`, and the removal of `run`.

- **Contract notes from sprint-151.** `create_agent_response` and `agent_prompt_response` now answer `{payload: {agentId}}` at acceptance; the turn's rows and one `agent_update` (`idle` or `error`) follow. A send right after the answer is refused with `busy` until that `agent_update`. `agent_update` is broadcast to every session. The daemon's `shutting_down` and (sprint-154) `too_many_requests` `rpc_error` codes exist.

## Out of scope
The connection-wide timeout and per-call timeouts (task-004).

## Acceptance criteria
- [ ] `waitForIdle` on an idle agent resolves at once; after `agent_update error` it resolves `error`;
      on archive or delete it resolves `closed`.
- [ ] A settle that arrives between the subscription and the status read is not missed.
- [ ] Timeout and abort reject and remove the listeners.
- [ ] `send` resolves `{agentId}` against the scripted daemon and against a dev daemon.

## Test / verification plan
- `npx vitest run packages/client`
- `npm run build:client`
