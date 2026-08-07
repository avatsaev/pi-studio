# Task 005 — SDK / client facade methods — Summary

- **Sprint:** sprint-037-agent-slash-commands
- **Completed:** 2026-07-22
- **Status:** done

## What was implemented
Added 11 methods to `PiStudioAgentActions` (interface) and its `AgentHandle` implementation in
`packages/client/src/pistudio-client.ts`: `sessionStats`, `compact`, `newSession`, `switchSession`,
`fork`, `forkMessages`, `clone`, `setSessionName`, `exportHtml`, `setModel`, `cycleModel`,
`lastAssistantText`. Each is a thin `this.daemon.request("<agent_..._request>", {agentId, ...})`
wrapper mirroring the exact style of the existing `interrupt()`/`update()`/`resume()` methods.

**Important correctness fix discovered mid-task:** `DaemonClient.request()`'s `resolvePending`
unwraps a correlated response to just its `payload` field (`"payload" in msg ? msg.payload : msg`
— confirmed by reading `daemon-client.ts` and cross-checked against the existing
`update_agent`/`agent_update` test in `pistudio-client.test.ts`). The task's suggested signatures
(`Promise<AgentSessionStatsResponse>` etc.) would have been wrong — every method's return type is
therefore `AgentXResponse["payload"]`, not the full envelope type. This matches how every other
facade method already behaves (e.g. `createAgent`'s `{agentId}` payload, not a `create_agent_response`
envelope).

## Files created / changed
| File | Change |
|------|--------|
| `packages/client/src/pistudio-client.ts` | modified — 11 new interface methods on `PiStudioAgentActions`, 11 new `AgentHandle` implementations, updated header doc comment's RPC type list |
| `packages/client/src/pistudio-client.test.ts` | modified — 2 new scripted-daemon response cases + a new `describe("PiStudioClient — slash-command operations (sprint-037)")` block with 3 tests |
| `packages/client/AGENTS.md` | modified — added the 11 methods to the `PiStudioAgentActions` RPC table + a context note on the `payload`-unwrapping behavior |

## How it satisfies the scope
- Each operation is a typed method on `AgentHandle` mapping to its task-001 RPC type with `agentId`,
  using the corrected `["payload"]` return type derived from the protocol response types.
- Follows the exact existing wrapper style (no client-side validation beyond the driver's).

## Build & test results
```
$ npx tsc -b packages/client
(no output — success)

$ npx vitest run packages/client/src/pistudio-client.test.ts
 Test Files  1 passed (1)
      Tests  10 passed (10)

$ npx vitest run packages/client
 Test Files  5 passed (5)
      Tests  42 passed (42)
```

## Acceptance criteria
- [x] Each operation is a typed method on `AgentHandle` mapping to its task-001 RPC type with `agentId`. (verified: 3 new tests asserting `fake.sent` request shapes)
- [x] Return types use the protocol response types where available. (as `AgentXResponse["payload"]`, corrected from the task's suggested full-envelope types — see note above)
- [x] `npm run build:client` and `npm run typecheck` pass. (`tsc -b packages/client` clean)

## Follow-ups / TODO(verify)
- The task's suggested signatures said `Promise<AgentSessionStatsResponse>` etc.; implemented as
  `Promise<AgentSessionStatsResponse["payload"]>` instead — documented in both the code comment and
  `AGENTS.md` so this doesn't get "fixed" back to the wrong shape later.
