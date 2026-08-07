# Task 002 — Create agent + run turn + stream broadcast

- **Sprint:** sprint-006-agent-sessions-timeline
- **Status:** done
- **Estimated size:** M
- **Depends on:** task-001; task-002 (sprint-005, Pi adapter)

## Goal
Implement `create_agent_request` handling and the run/turn loop that appends timeline rows and
broadcasts `agent_stream`, with the canonical-user-message rule.

## Scope references
- `clean-room-scope/features/agent-sessions.md` § Create, § Behavior (createAgent/run), § Canonical user message rule
- `clean-room-scope/architecture/websocket-protocol.md` § Session message families

## What to build
- Handler for `create_agent_request`: resolve workspace/cwd, validate `AgentSessionConfig`,
  `AgentManager.create(...)` (status `initializing`), `providerClient.createSession`, status `idle`;
  if `initialPrompt` → run the first turn; persist + broadcast `agent_update`; respond with `agentId`
  correlated by `requestId`.
- `run(agent, prompt)`: status `running` + broadcast; `session.startTurn`; for each event append to
  timeline (task-001) and broadcast `agent_stream` (delta or full per event); on
  `turn_completed`/`failed`/`canceled` → status `idle` (or `error`); emit canonical `user_message`
  exactly once keyed by provider message id; update attention flags.
- Dedupe optimistic/echoed user messages by **provider-visible message id**, not text.

## Out of scope
- Paged fetch (task-003). Interrupt/resume/import/update (task-004). Permissions (task-005).
  autoArchive coupling with worktrees (sprint-008).

## Acceptance criteria
- [ ] `create_agent_request` with `initialPrompt` creates an agent, runs the first turn, streams events.
- [ ] Exactly one `user_message` row exists per submitted prompt, keyed by provider message id.
- [ ] A turn produces `turn_started`…`turn_completed` rows and `agent_stream` broadcasts.
- [ ] `agent_update` broadcasts on status change; response correlates by `requestId`.

## Test / verification plan
- Tests: `npx vitest run .../create-run.test.ts` using the `mock` provider — create+run, single
  canonical user message, broadcast assertions.

## Notes
- `autoArchive` hook fires after the first terminal turn (full behavior wired in sprint-008 with worktrees).
