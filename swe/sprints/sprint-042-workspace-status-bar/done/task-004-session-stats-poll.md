# Task 004 — `use-session-stats` poll + model wiring on create/restore/update

- **Sprint:** sprint-042-workspace-status-bar
- **Status:** done
- **Estimated size:** M
- **Depends on:** task-003 (stores); relies on task-001/002 server fields at runtime

## Goal
Fill `stats-store` for the active session by polling `client.agent(id).sessionStats()`, and seed/
update `session-store.model` from create-agent config, restored `list_agents` entries, and
`agent_update` broadcasts — so context/tokens/cost/model stay current and swap correctly on session
switch.

## Background / why
Context usage, token totals, and cost are **pull-only** (no stream event carries them). The bar
therefore polls the existing `agent_session_stats_request` RPC (exposed by the SDK as
`client.agent(id).sessionStats()`), which after task-002 also returns the authoritative `model`.
Polling triggers: on session activate/mount, on each `turn_completed` for that agent, and on a light
interval (~12s) while the session is active. Results are cached per-sessionId (task-003) so
switching back is instant.

Model seeding has three entry points: the creating session already knows its model from the
create-agent config; restored sessions read `model` from the new `list_agents` field
(`use-session-restore.ts`); and live `/model` **set** changes arrive via `agent_update` (route into
`setModelByAgentId`). The poll's `model` reconciles everything else (cycle, cross-client).

## Scope references
- `clean-room-scope/features/agent-sessions.md` § Session stats
- `clean-room-scope/features/workspace-ui.md` § Header / status metadata
- `packages/web-client/AGENTS.md` § hooks, § session-store

## What to build
- **`packages/web-client/src/hooks/use-session-stats.ts`** (new): given the active session's
  `sessionId`/`agentId`, poll `client.agent(agentId).sessionStats()` and write
  `{contextTokens, contextWindow, contextPercent, totalTokens, inputTokens, outputTokens, cost,
  model}` into `stats-store.setStats(sessionId, …)`. Poll on mount/activate, on a ~12s interval,
  and re-poll when a `turn_completed` stream event is observed for `agentId`. Skip cleanly when
  there is no `agentId` yet (fresh, un-run session) or the RPC is unsupported (leave prior cache).
  Cancel the interval + any in-flight handling on unmount / session change.
- **`packages/web-client/src/hooks/use-session-restore.ts`**: extend the `RestoredAgent` interface
  with `model?`/`provider?`, and pass `model` into `sessionStore.hydrate({... model})`.
- **Model from `agent_update`**: in the existing agent-update handling path (where `agent_update`
  session messages are consumed to drive `setStatusByAgentId`), also call
  `setModelByAgentId(agentId, model)` when the broadcast carries a `model`.
- **Model from create**: where the create-agent response binds the agent to the session, set the
  session `model` from the create config.

## Out of scope
- The status-bar component itself (task-006) — this task only fills the stores.
- Number formatting (task-005).

## Acceptance criteria
- [ ] Activating a session with an `agentId` triggers a `sessionStats()` call that populates
  `stats-store` for that sessionId; switching away and back shows the cached value immediately then
  refreshes.
- [ ] A `turn_completed` for the active agent re-polls; the ~12s interval re-polls while active.
- [ ] A session with no agent (pre-first-turn) does not poll and does not error.
- [ ] Restored sessions carry `model` from `list_agents`; `/model`-set `agent_update` updates the
  session model live; the poll reconciles the model otherwise.
- [ ] `npm run typecheck` passes.

## Test / verification plan
- `use-session-stats` test with a mocked `PiStudioClient`: on mount calls `sessionStats`, writes the
  mapped fields to `stats-store`; a simulated `turn_completed` re-invokes it; no `agentId` → no call.
- `use-session-restore` test: a `list_agents` entry with `model:"opus"` hydrates a session whose
  `model==="opus"`.
- `npx vitest run packages/web-client/src/hooks`.
- Smoke (with `npm start`, real Pi provider): open a session, run a turn, confirm `stats-store`
  fills; switch sessions, confirm cached-then-refreshed.

## Notes
- Keep the poll light: a single in-flight request at a time per active session; drop overlapping
  ticks. The interval is a backstop — `turn_completed` is the primary refresh trigger.
