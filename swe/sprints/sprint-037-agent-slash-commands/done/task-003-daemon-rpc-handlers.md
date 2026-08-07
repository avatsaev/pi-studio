# Task 003 — Daemon RPC handlers for slash-command operations

- **Sprint:** sprint-037-agent-slash-commands
- **Status:** done
- **Estimated size:** M
- **Depends on:** task-001, task-002

## Goal
Register daemon RPC handlers for the new slash-command operations, resolving the target live
`AgentSession` and delegating to its new optional provider methods, broadcasting `agent_update`
where state changes, and surfacing `rpc_error` when unsupported/absent.

## Scope references
- `packages/server/src/agent/session-operations.ts` (`SessionOperationsService.registerHandlers`, `getActiveSessions`, `broadcastAll`, existing `handleInterrupt`/`handleUpdate` pattern)
- `packages/server/src/agent/index.ts` (service wiring)
- `packages/server/src/daemon/bootstrap.ts` (`HandlerRegistry.register` / `registerAlias`)
- `packages/server/AGENTS.md` § RPC handler registration is explicit; flat snake_case convention
- Root `AGENTS.md` § invariant 6 (rpcTimeoutMs ≠ socket death — operation-level failure only)

## What to build
Add handlers (in `SessionOperationsService`, or a sibling `SlashCommandOperationsService` in the
same file/dir if that keeps it cohesive) registered via `registry.register(...)`, one per task-001
request type:

- `agent_session_stats_request` → `session.getSessionStats()`
- `agent_compact_request` → `session.compact(customInstructions?)` → broadcast `agent_update` (context changed)
- `agent_new_session_request` → `session.newSession()` → broadcast
- `agent_switch_session_request` → `session.switchSession(sessionPath)` → broadcast
- `agent_fork_request` → `session.fork(entryId)`; `agent_fork_messages_request` → `session.getForkMessages()`
- `agent_clone_request` → `session.clone()`
- `agent_set_session_name_request` → `session.setSessionName(name)` → update record `title`? (decide; at minimum broadcast)
- `agent_export_html_request` → `session.exportHtml(outputPath?)`
- `agent_set_model_request` / `agent_cycle_model_request` → `session.setModel(...)` / `session.cycleModel()` → persist+broadcast (reuse existing update path where possible)
- `agent_last_assistant_text_request` → `session.getLastAssistantText()`

Each handler: resolve the session by `agentId` from `getActiveSessions()`; if not found →
`rpc_error`. If the provider method is absent (optional, e.g. `mock`) → `rpc_error` with a clear
`unsupported`-style message (NOT a silent success). Return the mapped response payload from task-001.

## Out of scope
- Wire schemas (task-001), provider impl (task-002), mock stubs (task-004), SDK/CLI (005/006).
- Recreating the session; these operate on the live session in place.

## Acceptance criteria
- [ ] Each new request type has a registered handler resolving the live session and delegating to the provider method.
- [ ] Unknown `agentId` → `rpc_error`; provider method absent → `rpc_error` (not silent).
- [ ] State-changing ops (compact/new/switch/clone/set_model/set_session_name) broadcast `agent_update`.
- [ ] Handler registration is explicit in the bootstrap wiring, consistent with existing services.
- [ ] `npm run build:server` and `npm run typecheck` pass.

## Test / verification plan
- Tests: extend `packages/server/src/agent/session-ops.test.ts` (or a new `slash-ops.test.ts`) with a
  stub session exposing the new methods — assert delegation, response shape, `agent_update`
  broadcast on state change, and `rpc_error` for unknown agent + unsupported provider.
  `npx vitest run packages/server/src/agent/session-ops.test.ts`.

## Notes
- Match the `interrupt_agent`/`update_agent` handler style exactly (ctx.message cast, broadcastAll).
- If a dotted alias is desirable for any op, register the flat name as canonical and add the alias
  (mirrors `registerAlias("cancel_agent", "interrupt_agent")`).
