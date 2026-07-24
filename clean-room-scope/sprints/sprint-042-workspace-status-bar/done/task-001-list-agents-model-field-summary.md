# Task 001 — Surface model/provider on `list_agents_response` — Summary

- **Sprint:** sprint-042-workspace-status-bar
- **Completed:** 2026-07-24
- **Status:** done

## What was implemented
Added `provider`/`model` fields to every entry `list_agents_request` returns, in both the
production (`bootstrap.ts`) and dev (`dev-bootstrap.ts`) daemon handlers.

## Deviation from the task file (investigated, not assumed)
The task assumed `list_agents_response` had a protocol Zod schema and that `record.config`/
`record.runtimeInfo` were populated at agent-creation time. Neither is true in the current
codebase:
- **No protocol schema exists** for `list_agents_request`/`response` at all — it is (and remains)
  an untyped ad hoc RPC on both server and client. No `packages/protocol` change was made.
- **`AgentRecord.config` and `AgentRecord.runtimeInfo` are never written** anywhere in the server
  (`updateRecord` is only called with `config` from the `/model`-style config-update RPC path, not
  from `create_agent_request`; `runtimeInfo` has zero write sites at all). Sourcing `model` from
  those fields alone would silently return `undefined` for every freshly created agent.

Fixed the actual source to the **live, attached session**'s `getRuntimeInfo().model`
(`ManagedAgent.session?.getRuntimeInfo().model`), falling back to `record.config?.model` for the
rare case where a record exists in the manager without a currently attached session. `provider` is
read from the always-present, required `record.provider` field (never falls back, since a session's
provider is fixed at creation). This still satisfies the goal — the client-facing contract is
unchanged (`list_agents_response` entries carry optional `model`/`provider`) — but the daemon-side
data source is different from what the task described, because the daemon does not persist that
data the way the task assumed.

## Files created / changed
| File | Change |
|------|--------|
| `packages/server/src/daemon/bootstrap.ts` | `list_agents_request` handler now adds `provider: m.record.provider` and `model: m.session?.getRuntimeInfo().model ?? m.record.config?.model` to each entry |
| `packages/server/src/daemon/dev-bootstrap.ts` | same two fields added to its own `list_agents_request` handler |
| `packages/server/src/daemon/bootstrap.test.ts` | extended the existing "creates an agent via the opt-in mock provider…" test to create the agent with `config.model: "mock-model-x"` and assert the `list_agents_request` entry echoes `provider: "mock"` and `model: "mock-model-x"` |

## How it satisfies the scope
- `clean-room-scope/architecture/websocket-protocol.md` § Session RPC envelopes (append-only rule):
  satisfied trivially — no schema exists to narrow; the untyped payload only gained two new keys,
  which is append-only in spirit for an ad hoc RPC.
- `clean-room-scope/features/agent-sessions.md` § Agent directory / listing: the directory listing
  now surfaces the running model/provider per agent, closing the gap that motivated this task (a
  reconnecting web-client can label a restored session's model without any extra round trip, as
  long as the daemon process — and therefore the live session — is still running, which is the
  actual "restore" scenario in the UI: a client reconnecting to an already-running daemon, not a
  daemon restart).

## Build & test results
```
$ npm run build:server
> tsc -b packages/server && chmod +x packages/server/dist/daemon/main.js
(success, no output)

$ npx vitest run packages/server/src/daemon/bootstrap.test.ts
✓ packages/server/src/daemon/bootstrap.test.ts (9 tests) 95ms
Test Files  1 passed (1)
     Tests  9 passed (9)

$ npm run typecheck
> tsc -b
(success, no output)
```

## Acceptance criteria
- [x] `list_agents_response` entries carry optional `model`/`provider`; a payload without them
  still validates (no schema exists to violate; absent fields simply serialize as absent) —
  verified by the extended bootstrap test asserting presence, and every other existing
  `list_agents_request` assertion in the same file continuing to pass unmodified.
- [x] Both `bootstrap.ts` and `dev-bootstrap.ts` populate the two fields — verified by reading both
  files post-edit; `dev-bootstrap.ts` has no dedicated test file (none existed before this task
  either), so it was verified by direct code review + the shared build/typecheck pass.
- [x] No existing `list_agents_response` field removed or narrowed — verified by diff review; only
  two keys added to the mapped object in each handler.
- [x] `npm run build:protocol`, `npm run build:server`, `npm run typecheck` pass — protocol build
  was a no-op (no protocol change was needed or made, per the deviation above); server build and
  full-workspace typecheck both green.

## Follow-ups / TODO(verify)
- **TODO(verify):** if a future daemon-restart/resume path is added where `manager.list()` can
  return agents with `session === null` (record loaded from disk, not yet resumed), the `model`
  field will silently fall back to `record.config?.model`, which today is also unpopulated for
  agents created via `create_agent_request` — such an agent would show no model until the
  create/update path is changed to persist `config`. Not exercised by any current code path (all
  currently-listed agents in this daemon have a live attached session), so left as-is per this
  task's minimal scope. Consider persisting `runtimeInfo`/`config` at creation time as a separate,
  small hardening task if daemon-restart resume-without-model becomes a real scenario.
