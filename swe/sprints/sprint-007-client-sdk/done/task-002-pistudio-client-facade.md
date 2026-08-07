# Task 002 — Pi-StudioClient facade + handles

- **Sprint:** sprint-007-client-sdk
- **Status:** done
- **Estimated size:** M
- **Depends on:** task-001

## Goal
Implement the high-level `Pi-StudioClient` SDK facade with workspace/agent/provider handles and update
handlers over the `DaemonClient` driver.

## Scope references
- `clean-room-scope/architecture/client-app-runtime.md` § Layered client library (Facade)
- `clean-room-scope/features/agent-sessions.md` (operations the facade exposes)

## What to build
- `packages/client/src/index.ts`: `Pi-StudioClient` exposing handles —
  `Pi-StudioWorkspaceHandle`/`Pi-StudioWorkspaceActions`, `Pi-StudioAgentHandle`/`Pi-StudioAgentActions`
  (with `Pi-StudioAgentTimelineHandle`), `Pi-StudioProviderActions` — plus update handler types
  (`Pi-StudioWorkspaceUpdateHandler`, `Pi-StudioAgentUpdateHandler`).
- Agent actions: create/run/send/interrupt/update/resume/import/archive; timeline handle:
  fetch pages + subscribe to `agent_stream`.
- Provider actions: list providers/models/modes; snapshot refresh trigger.

## Out of scope
- App-level runtime controller (sprint-012). Terminal router (task-003).

## Acceptance criteria
- [ ] `Pi-StudioClient` creates an agent and receives streamed events via the agent handle.
- [ ] The timeline handle fetches paged history and subscribes to live updates.
- [ ] Update handlers fire on `agent_update`/`workspace_update`.
- [ ] Provider actions list models/modes and trigger a snapshot refresh.

## Test / verification plan
- Tests: `npx vitest run packages/client/.../pistudio-client.test.ts` against the sprint-004/006 server
  with the `mock` provider — agent create+stream, timeline fetch+subscribe, update handlers.

## Notes
- Exact method names/signatures per handle are TODO(verify); keep them stable for app + CLI reuse.
