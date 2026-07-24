# Task 003 — Daemon RPC handler for command discovery

- **Sprint:** sprint-040-agent-command-discovery
- **Status:** backlog
- **Estimated size:** S
- **Depends on:** task-001, task-002

## Goal
Register a daemon RPC handler for `agent_list_commands_request` that resolves the target live
`AgentSession`, delegates to `session.listCommands()`, and returns the mapped command list — with
`rpc_error` when the agent is unknown or the provider lacks the capability.

## Background / why
The `get_commands` op belongs to the same family as the sprint-037 slash-command ops, so it lives
in the existing `SlashCommandOperationsService` (`slash-command-operations.ts`). It is **read-only**
(no state change), so it broadcasts nothing — same shape as `handleSessionStats` /
`handleLastAssistantText`. Both `bootstrap.ts` and `dev-bootstrap.ts` already call
`slashCommandOps.registerHandlers(...)`, so the new handler registers automatically with no
bootstrap edit.

## Scope references
- `packages/server/src/agent/slash-command-operations.ts` (`SlashCommandOperationsService`,
  `registerHandlers`, `requireSession`, `unsupported`, the read-only `handleSessionStats` /
  `handleLastAssistantText` handlers as the exact template)
- `packages/server/src/daemon/bootstrap.ts` + `dev-bootstrap.ts` (already wire
  `slashCommandOps.registerHandlers` — no change expected)
- `packages/server/AGENTS.md` § RPC handler registration is explicit; flat snake_case convention
- Root `AGENTS.md` § invariant 6 (rpcTimeoutMs ≠ socket death — operation-level failure only)

## What to build
In `SlashCommandOperationsService`:
- Register `agent_list_commands_request` in `registerHandlers`.
- Add `handleListCommands(msg)`: `requireSession(manager, agentId)` → guard `session.listCommands`
  (absent → `throw unsupported(agentId, "get_commands")`) → `const commands = await
  session.listCommands()` → `return { type: "agent_list_commands_response", payload: { commands } }`.
- No `broadcastAgentUpdate` (read-only).
- Update the class docstring's command inventory to note command discovery.

## Out of scope
- Wire schemas (task-001), provider impl (task-002), mock stub + verification (task-004).
- SDK/CLI/MCP/web-client surfaces.

## Acceptance criteria
- [ ] `agent_list_commands_request` has a registered handler resolving the live session and
      delegating to `session.listCommands()`.
- [ ] Unknown `agentId` → `rpc_error`; `listCommands` absent → `rpc_error` (not silent success).
- [ ] Response payload matches the task-001 schema (`{ commands: [...] }`).
- [ ] No bootstrap wiring change needed (handler picked up via the existing `registerHandlers`).
- [ ] `npm run build:server` and `npm run typecheck` pass.

## Test / verification plan
- Tests: add coverage in the slash-command handler suite (or a stub-session test) asserting
  delegation, the `{ commands }` response shape, `rpc_error` for an unknown agent, and `rpc_error`
  when a stub session omits `listCommands`.
- Add `{ type: "agent_list_commands_request", agentId: "missing" }` to the `slashCommandProbes`
  array in `packages/server/src/daemon/bootstrap.test.ts` to confirm the handler is wired and
  returns a clean `rpc_error` for an unknown agent.
- `npx vitest run packages/server/src/agent packages/server/src/daemon/bootstrap.test.ts`.

## Notes
- Match `handleSessionStats`'s shape exactly (ctx.message cast, `requireSession`, `unsupported`).
- No dotted alias needed — flat name is canonical (consistent with the other slash-command ops).
