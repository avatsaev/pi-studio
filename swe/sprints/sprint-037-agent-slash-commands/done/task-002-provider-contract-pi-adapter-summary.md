# Task 002 — Provider-contract methods + Pi adapter RPC wiring — Summary

- **Sprint:** sprint-037-agent-slash-commands
- **Completed:** 2026-07-22
- **Status:** done

## What was implemented
Added 11 optional slash-command methods to the `AgentSession` interface in
`packages/server/src/agent/provider-contract.ts` (`getSessionStats`, `compact`, `newSession`,
`switchSession`, `fork`, `getForkMessages`, `clone`, `setSessionName`, `exportHtml`,
`setProviderModel`, `cycleModel`, `getLastAssistantText`), plus 4 provider-neutral result
interfaces (`AgentSessionStats`, `AgentCompactResult`, `AgentForkMessage`,
`AgentCycleModelResult`). Implemented every method on `PiAgentSession` in
`packages/server/src/agent/providers/pi/agent.ts` as thin `this.transport.request(command,
params)` wrappers (request/response, unlike the fire-and-forget `prompt`/`abort` `notify()` calls),
mapping each Pi RPC response into the neutral shape.

Deliberately added `setProviderModel(provider, modelId)` as a **new** method rather than
implementing the pre-existing `setModel?(id: string)` — that legacy single-string signature cannot
carry the `provider` field Pi's real `set_model` RPC requires, and it was never actually
implemented anywhere in the Pi adapter (confirmed by grep before writing). `setModel?` is left
untouched to avoid an unrelated signature-breaking change outside this task's scope.

## Files created / changed
| File | Change |
|------|--------|
| `packages/server/src/agent/provider-contract.ts` | modified — added result interfaces + 11 optional `AgentSession` methods |
| `packages/server/src/agent/providers/pi/agent.ts` | modified — implemented all 11 methods on `PiAgentSession` via `transport.request(...)`; updated type imports |
| `packages/server/src/agent/providers/pi/pi-adapter.test.ts` | modified — `FakeTransport.request` now scripts all new Pi RPC commands; added `describe("slash-command operations (sprint-037)")` with 7 tests |

## How it satisfies the scope
- All new methods are optional (`?`), matching the existing capability-detection pattern
  (`setModel?`, `listCommands?`) — `mock` and any future provider can omit them freely.
- Each Pi implementation issues the exact RPC command name from `docs/rpc.md` (`get_session_stats`,
  `compact`, `new_session`, `switch_session`, `fork`, `get_fork_messages`, `clone`,
  `set_session_name`, `export_html`, `set_model`, `cycle_model`, `get_last_assistant_text`) via
  `PiRpcTransport.request`, never `notify` — these are correlated request/response commands per
  the RPC contract, not queued prompts.
- No non-optional contract change; `mock` provider (task-004) is unaffected and still compiles.

## Build & test results
```
$ npx tsc -b packages/server
(no output — success)

$ npx vitest run packages/server/src/agent/providers/pi/pi-adapter.test.ts
 Test Files  1 passed (1)
      Tests  19 passed (19)

$ npx vitest run packages/server
 Test Files  46 passed (46)
      Tests  318 passed (318)
```

## Acceptance criteria
- [x] New optional methods added to `AgentSession` (and result interfaces). (verified: `tsc -b` clean)
- [x] `PiAgentSession` implements each via `transport.request(...)`, returning mapped neutral results. (verified: 7 new tests in pi-adapter.test.ts)
- [x] `/model` set issues the Pi `set_model` RPC (not local-only) — verified against current code. (implemented as new `setProviderModel`; legacy `setModel?` was confirmed never implemented and left untouched)
- [x] No non-optional contract change that breaks `mock` compilation. (verified: full server suite green, incl. mock-provider.test.ts)
- [x] `npm run build:server` and `npm run typecheck` pass. (`tsc -b packages/server` clean)

## Follow-ups / TODO(verify)
- The existing `setModel?(id: string)` / `session-operations.ts`'s `update_agent` handler still call
  the old single-string method, which for the Pi adapter is a no-op (never implemented). This
  pre-existing gap is out of this task's scope; task-003's `agent_set_model_request` handler will
  use the new `setProviderModel` instead.
- `set_model`'s response `data` (the full Pi `Model` object) is passed through as `unknown` per the
  protocol task-001 decision — no further mapping applied here.
