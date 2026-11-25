# Task 004 — External fixtures and changelog for create and send

- **Sprint:** sprints/sprint-151-instant-replies-daemon
- **Status:** done
- **Type:** test
- **Area:** packages/protocol (fixtures), packages/server (fixture e2e), docs
- **Priority:** P2
- **Estimated size:** S
- **Depends on:** task-003

## Goal
The new create and send contract is pinned as external-client fixtures and written down.

## Context / why
No fixture covers create or send today, so the guard cannot see this change. The handoff asks for the
fixture and changelog procedure on M4. In fixture terms the change is additive (new files), but the
behaviour change is breaking for any client that waited on the answer, so the changelog says so.

## Scope references
- `docs/daemon-audit-handoff.md` § "M4 contract" (point 6)
- `packages/protocol/fixtures/external-clients/` (`README.md` § Compatibility rule, `manifest.json`
  `formatVersion` 2, `.signatures.json`, `CHANGELOG.md`), `packages/protocol/src/external-fixtures.test.ts`
- `packages/server/src/daemon/external-fixtures-e2e.test.ts`, `packages/server/scripts/record-external-fixtures.ts`
- Docs: root `AGENTS.md` § Protocol overview, `swe/features/agent-sessions.md` (§ Create :17-48, the
  response rows near :146, § Other operations :56), `swe/architecture/websocket-protocol.md` (:48),
  `swe/architecture/daemon-bootstrap.md` (:65), `docs/agent-stream-events.md`

## What to build
- Fixtures: `create_agent_request.json`, `create_agent_response.json`, `send_agent_prompt.json`,
  `agent_prompt_response.json` (`since` is the version this ships in; volatile ids marked), listed in
  the manifest; signatures regenerated with `npm run fixtures:update -w @av-pi-studio/protocol`.
- `CHANGELOG.md`: a dated "Additive" entry (formatVersion stays 2) that also states the behaviour
  change: both answers now mean "accepted", `agent_prompt_response` has `payload.agentId` and no
  `status`, and the outcome is the turn's rows plus one `agent_update`.
- Layer B: the e2e proves a live dev daemon matches the four fixtures and that the answer precedes the
  first `agent_stream` frame of the turn. The record script prints the new candidates.
- Docs: a "Create and send answer at acceptance" bullet in the root `AGENTS.md` protocol overview, and
  the spec files above.

- The `rpc_error.json` fixture description and the comment in `packages/protocol/src/messages.ts` (~:1110) say the router only emits `unknown_message_type` / `handler_error`; sprint-153/task-002 added `shutting_down` (and sprint-154 adds `too_many_requests`). Update both texts, and state in the CHANGELOG that `code` is an open string.

## Out of scope
Clients (sprint 152).

## Acceptance criteria
- [ ] `npx vitest run packages/protocol packages/server/src/daemon/external-fixtures-e2e.test.ts` passes.
- [ ] The guard refuses a hand-made removal of `payload.agentId` from a fixture (existing guard test
      style), and accepts the tree as committed.
- [ ] The docs no longer say that create or send answer when the turn ends.

## Test / verification plan
- `npx vitest run packages/protocol packages/server/src/daemon/external-fixtures-e2e.test.ts`
- `npm run build:protocol && npm run build:server`
