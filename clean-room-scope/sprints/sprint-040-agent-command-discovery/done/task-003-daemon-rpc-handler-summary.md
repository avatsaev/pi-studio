# Task 003 — Daemon RPC handler for command discovery — Summary

- **Sprint:** sprint-040-agent-command-discovery
- **Completed:** 2026-07-26
- **Status:** done

## What was implemented
Registered a daemon RPC handler for `agent_list_commands_request` in the existing
`SlashCommandOperationsService`, following the read-only `handleLastAssistantText`/
`handleSessionStats` template exactly: resolve the live session via `requireSession`, guard the
optional `listCommands` capability (absent → `unsupported(agentId, "get_commands")`, which the
router turns into `rpc_error`), delegate, and return `{ type: "agent_list_commands_response",
payload: { commands } }`. No broadcast (read-only). Both `bootstrap.ts` and `dev-bootstrap.ts`
already call `slashCommandOps.registerHandlers(...)`, so the handler is wired automatically — no
bootstrap edit was needed.

## Files created / changed
| File | Change |
|------|--------|
| `packages/server/src/agent/slash-command-operations.ts` | registered `agent_list_commands_request` in `registerHandlers`; added `handleListCommands`; extended the class docstring with a command-discovery (sprint-040) paragraph |
| `packages/server/src/agent/slash-command-ops.test.ts` | added two unit tests in the "delegation to optional AgentSession methods" describe block: delegation + response-shape assertion (via `sessionStub({ listCommands: ... })`), and an `rpc_error`-on-absent assertion (`sessionStub()` with no override — `listCommands` stays undefined) |
| `packages/server/src/daemon/bootstrap.test.ts` | added `{ type: "agent_list_commands_request", agentId: "missing" }` to the `slashCommandProbes` array (confirms the handler is wired end-to-end and returns a clean `rpc_error` for an unknown agent, not `unknown_message_type`) |

## How it satisfies the scope
- Matches `handleSessionStats`/`handleLastAssistantText`'s exact shape: `ctx.message` cast,
  `requireSession`, `unsupported` guard, no `broadcastAgentUpdate` call.
- No dotted alias registered — flat name only, consistent with every other slash-command op.
- The unsupported-path unit test deliberately uses a `sessionStub()` override (not the real `mock`
  provider), so it stays correct independent of whatever task-004 adds to the mock provider's
  `listCommands` support — the mock-provider-specific "absent capability" coverage continues to
  live on `handleExportHtml` (mock has no `exportHtml`), per task-004's explicit instruction to
  keep at least one *other* optional method omitted on the mock.

## Build & test results
```
$ npm run build:server
> tsc -b packages/server && chmod +x packages/server/dist/daemon/main.js
(clean, no output)

$ npx vitest run packages/server/src/agent/slash-command-ops.test.ts packages/server/src/daemon/bootstrap.test.ts
 Test Files  2 passed (2)
      Tests  29 passed (29)
```

## Acceptance criteria
- [x] `agent_list_commands_request` has a registered handler resolving the live session and
      delegating to `session.listCommands()`. (verified by the delegation unit test)
- [x] Unknown `agentId` → `rpc_error`; `listCommands` absent → `rpc_error` (not silent success).
      (verified by the bootstrap probe + the sessionStub-based unit test respectively)
- [x] Response payload matches the task-001 schema (`{ commands: [...] }`).
- [x] No bootstrap wiring change needed (handler picked up via the existing `registerHandlers`).
- [x] `npm run build:server` and `npm run typecheck` pass.

## Follow-ups / TODO(verify)
- None. `npm run typecheck` (workspace-wide) is re-verified at sprint end per the plan.
