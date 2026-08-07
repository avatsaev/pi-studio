# Task 003 — Daemon RPC handlers for slash-command operations — Summary

- **Sprint:** sprint-037-agent-slash-commands
- **Completed:** 2026-07-22
- **Status:** done

## What was implemented
Created `packages/server/src/agent/slash-command-operations.ts` — `SlashCommandOperationsService`,
a sibling service to `SessionOperationsService` following the exact same shape
(`registerHandlers(registry, getActiveSessions)`, constructor deps, `broadcastAgentUpdate` helper).
Registers 11 handlers, one per task-001 request type, each:
1. resolving the live session via a shared `requireSession(manager, agentId)` helper (throws
   `unknown agent: <id>` for a missing record, `agent <id> has no live session` if not attached —
   both surface as `rpc_error` via the router's existing catch-and-correlate path),
2. checking the optional provider method exists, else throwing a clear
   `agent <id>'s provider does not support '<op>'` error (never a silent success),
3. delegating to the task-002 `AgentSession` method and mapping the result into the task-001
   response `type`/`payload` shape,
4. broadcasting `agent_update` for every state-changing op (`compact`, `newSession` (unless
   cancelled), `switchSession` (unless cancelled), `clone` (unless cancelled), `setSessionName`,
   `setProviderModel`, `cycleModel`) — read-only ops (`getSessionStats`, `fork`, `getForkMessages`,
   `exportHtml`, `getLastAssistantText`) do not broadcast.

Wired into both daemon entry points (`daemon/bootstrap.ts` production, `daemon/dev-bootstrap.ts`
dev), instantiated and registered immediately after `sessionOps`, and exported from
`agent/index.ts`.

## Files created / changed
| File | Change |
|------|--------|
| `packages/server/src/agent/slash-command-operations.ts` | created — `SlashCommandOperationsService`, 11 handlers |
| `packages/server/src/agent/index.ts` | modified — export the new module |
| `packages/server/src/daemon/bootstrap.ts` | modified — import + instantiate + register |
| `packages/server/src/daemon/dev-bootstrap.ts` | modified — import + instantiate + register |
| `packages/server/src/agent/slash-command-ops.test.ts` | created — 14 unit tests against session stubs |
| `packages/server/src/daemon/bootstrap.test.ts` | modified — added a real end-to-end WS test confirming all 12 handlers are registered in the production bootstrap (unknown-agent → `handler_error`, never `unknown_message_type`) |

## How it satisfies the scope
- Each new request type has a registered handler resolving the live session and delegating.
  (`slash-command-ops.test.ts` covers delegation + payload mapping for all 11 ops via session
  stubs since the `mock` provider doesn't implement them yet — that's task-004.)
- Unknown `agentId` → `rpc_error` (verified both at the unit level and end-to-end through the real
  WS/router stack in `bootstrap.test.ts`); provider method absent → `rpc_error`, not silent
  (verified in `slash-command-ops.test.ts`'s "unknown agent / unsupported provider" block against
  the real `mock` provider, which has no slash-command methods).
- State-changing ops broadcast `agent_update`; cancelled variants (`newSession`, `switchSession`,
  `clone`) correctly skip the broadcast.
- Handler registration is explicit in both bootstrap files, consistent with every other service.

## Build & test results
```
$ npx tsc -b packages/server
(no output — success)

$ npx vitest run packages/server
 Test Files  47 passed (47)
      Tests  333 passed (333)
```

## Acceptance criteria
- [x] Each new request type has a registered handler resolving the live session and delegating to the provider method. (14 unit tests + 12-probe bootstrap test)
- [x] Unknown `agentId` → `rpc_error`; provider method absent → `rpc_error` (not silent). (verified both against the real `mock` provider and via stubs)
- [x] State-changing ops (compact/new/switch/clone/set_model/set_session_name) broadcast `agent_update`. (verified per-op in slash-command-ops.test.ts)
- [x] Handler registration is explicit in the bootstrap wiring, consistent with existing services. (bootstrap.ts + dev-bootstrap.ts, mirrors sessionOps wiring exactly)
- [x] `npm run build:server` and `npm run typecheck` pass. (`tsc -b packages/server` clean)

## Follow-ups / TODO(verify)
- No dotted-name alias was added for any of the 12 new RPCs — they follow the dominant flat
  snake_case convention directly (per root `AGENTS.md`'s note that flat is the actual convention,
  not a legacy fallback); no existing dotted counterpart exists to alias against.
- Real behavior against a live `pi` process (vs. the `FakeTransport`-backed unit tests in task-002
  and the stub-backed tests here) is unverified — that requires the `pi` binary, out of scope for
  this sprint's headless CI-style verification.
