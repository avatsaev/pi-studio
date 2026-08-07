# Task 001 — Surface model/provider on `list_agents_response`

- **Sprint:** sprint-042-workspace-status-bar
- **Status:** done
- **Estimated size:** S
- **Depends on:** none

## Goal
Add optional `model?` and `provider?` fields to every agent entry returned by
`list_agents_request`, sourced from the persisted agent record's config, so a reconnecting client
can label each restored session's model without a round-trip. Append-only, no existing field
narrowed.

## Background / why
The workspace status bar's first segment shows the current model. For the session that *created*
an agent, the model is known from the create-agent config; for a **restored** session (fetched via
`list_agents_request` on reconnect) it is not — `list_agents_response` today returns only
`agentId/status/title/cwd/labels/lastActivity`. `agent_update` broadcasts a model only on an
explicit `/model` **set** (not on create, not on cycle), so restore has no model source at all.
Adding the field to the directory listing closes that gap.

The agent record already persists `config` (`AgentSessionConfig` — includes `provider`, `model`).
Both the production `bootstrap.ts` and `dev-bootstrap.ts` build the `list_agents_response` payload
independently; both must be updated to stay consistent.

## Scope references
- `clean-room-scope/architecture/websocket-protocol.md` § Session RPC envelopes (append-only rule)
- `clean-room-scope/features/agent-sessions.md` § Agent directory / listing
- `packages/protocol/AGENTS.md` (append-only rule; flat snake_case)
- `packages/server/AGENTS.md` (list_agents handler, both bootstraps)

## What to build
- **`packages/protocol/src/messages.ts`**: extend the `list_agents_response` agent-entry schema
  with `model: z.string().optional()` and `provider: z.string().optional()` (the entry object is
  already `.passthrough()` + optional-heavy; do not narrow existing fields).
- **`packages/server/src/daemon/bootstrap.ts`** (`list_agents_request` handler): add
  `model: m.record.config?.model` and `provider: m.record.config?.provider` to each mapped entry.
- **`packages/server/src/daemon/dev-bootstrap.ts`** (its own `list_agents_request` handler): same
  two fields, so the dev daemon matches.

## Out of scope
- Any new RPC or stream event.
- Reconciling the model after a `/model` cycle — handled by the stats poll in task-002/004.
- Client consumption of the field — task-003 (session-store) / task-004 (restore wiring).

## Acceptance criteria
- [ ] `list_agents_response` entries carry optional `model`/`provider`; a payload without them
  still validates (old daemons/records tolerated).
- [ ] Both `bootstrap.ts` and `dev-bootstrap.ts` populate the two fields from `record.config`.
- [ ] No existing `list_agents_response` field removed or narrowed.
- [ ] `npm run build:protocol`, `npm run build:server`, `npm run typecheck` pass.

## Test / verification plan
- Protocol: extend the session-messages test to assert a `list_agents_response` entry parses with
  and without `model`/`provider`. `npx vitest run packages/protocol`.
- Server: extend the bootstrap test that already probes `list_agents_request` (see
  `packages/server/src/daemon/bootstrap.test.ts`) — create a mock agent with a known
  `config.model`, list agents, assert the entry echoes `model`/`provider`.
  `npx vitest run packages/server/src/daemon/bootstrap.test.ts`.

## Notes
- `config` on the record is optional/passthrough; guard with `?.` — a legacy record without config
  simply yields `undefined`, which serializes as an absent field. That's the intended empty state
  (task-006 hides the model segment when absent).
