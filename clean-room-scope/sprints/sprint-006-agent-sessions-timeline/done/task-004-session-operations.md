# Task 004 — Session operations: prompt, interrupt, update, resume, import

- **Sprint:** sprint-006-agent-sessions-timeline
- **Status:** done
- **Estimated size:** M
- **Depends on:** task-002

## Goal
Implement the remaining agent-session operations beyond create/first-run.

## Scope references
- `clean-room-scope/features/agent-sessions.md` § Other operations, § Error Handling
- `clean-room-scope/features/agent-providers.md` § Import & resume

## What to build
- Send a follow-up prompt (foreground/`send_agent_prompt` mirror) → runs another turn.
- Interrupt the current turn → `session.interrupt()` → `turn_canceled` → agent returns to `idle`.
- Update config (model/mode/thinking/features/title) → persist + broadcast WITHOUT recreating the
  session unnecessarily; prefer provider top-level list APIs for draft metadata.
- Resume a closed session via `PersistenceHandle`; surface `rpc_error` on stale handle.
- Import a native provider session: `listImportableSessions` (rows) → `importSession({ providerHandleId,
  cwd })` returns resumed session + storage config + persistence handle + hydrated timeline;
  `AgentManager.importProviderSession` seeds the timeline and publishes the agent only when ready.

## Out of scope
- Permissions (task-005). Structured-gen titles (task-006).

## Acceptance criteria
- [ ] Interrupting a running turn yields `turn_canceled` and returns the agent to `idle`.
- [ ] Resuming a closed agent via its `PersistenceHandle` restores the conversation.
- [ ] Importing a native session seeds the daemon timeline before publishing the agent.
- [ ] Updating model/mode/thinking/features persists+broadcasts without an unnecessary session recreate.
- [ ] A stale resume handle surfaces `rpc_error`.

## Test / verification plan
- Tests: `npx vitest run .../session-ops.test.ts` using `mock`/stub — interrupt, update, resume,
  import (seed-before-publish), stale-handle error.

## Notes
- Exact wire type names for send/interrupt/update are TODO(verify).
