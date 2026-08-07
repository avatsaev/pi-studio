# Task 002 — PiStudioClient facade + handles — Summary

- **Sprint:** sprint-007-client-sdk
- **Completed:** 2026-06-11
- **Status:** done

## What was implemented
`packages/client/src/pistudio-client.ts` — `PiStudioClient` SDK facade over `DaemonClient`:
- **Handles:** `client.agent(id)` → `PiStudioAgentActions` (with `.timeline:
  PiStudioAgentTimelineHandle`), `client.workspace(id)` → `PiStudioWorkspaceActions`,
  `client.providers` → `PiStudioProviderActions`.
- **Agent actions:** `createAgent`, `send`/`run`, `interrupt`, `update` (model/mode/thinking/
  features/title/labels — no recreate), `resume`, `archive`, `onUpdate`. Method→RPC names mirror the
  server: `create_agent_request`, `send_agent_prompt`, `interrupt_agent`, `update_agent`,
  `resume_agent`, `archive_agent`, `import_agent_session` (`importAgentSession` helper).
- **Timeline handle:** `fetch({cursor,direction,limit})` → `fetch_agent_timeline_request`;
  `subscribe(handler)` taps `agent_stream` filtered by `agentId`.
- **Provider actions:** `listProviders`, `listModels`, `listModes`, `refreshSnapshot`
  (`providers.snapshot.refresh.request`, dotted convention).
- **Update handlers:** `onAgentUpdate` / `onWorkspaceUpdate` (all-entity) plus per-handle `onUpdate`
  scoped by id. Types: `PiStudioAgentUpdateHandler`, `PiStudioWorkspaceUpdateHandler`.

## Files created / changed
| File | Change |
|------|--------|
| `packages/client/src/pistudio-client.ts` | created |
| `packages/client/src/index.ts` | modified |
| `packages/client/src/pistudio-client.test.ts` | added — 7 tests |

## Commands & results
- `npm run build:client` → exit 0 (no type errors)
- `npx vitest run packages/client/src/pistudio-client.test.ts` → **7 passed**
- `npx oxlint packages/client` → clean
- `npx oxfmt --check packages/client` → clean

Tested against a scripted in-memory daemon transport (handshake + correlated responses +
broadcasts) using the `mock`-provider semantics from sprint-006.

## Acceptance criteria
- [x] `PiStudioClient` creates an agent and receives streamed events via the agent handle.
- [x] The timeline handle fetches paged history and subscribes to live updates (own-agent only).
- [x] Update handlers fire on `agent_update` / `workspace_update`.
- [x] Provider actions list models/modes and trigger a snapshot refresh.

## Notes / TODO(verify)
- Exact method names/signatures per handle (kept stable for app + CLI reuse).
- Provider list RPC names (`list_provider_models`/`list_provider_modes`) are not yet served by the
  daemon (provider snapshot RPC wiring is deferred); the facade contract is in place.
