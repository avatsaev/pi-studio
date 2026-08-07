# Task 002 — Include current model in `agent_session_stats` payload — Summary

- **Sprint:** sprint-042-workspace-status-bar
- **Completed:** 2026-07-24
- **Status:** done

## What was implemented
`agent_session_stats_request`'s handler now back-fills `payload.model` from the live session's
`getRuntimeInfo().model` whenever the provider's own `getSessionStats()` result doesn't already
carry a `model`. A provider-supplied model is preserved as-is. Added the optional `model` field to
both the protocol wire schema and the server-side `AgentSessionStats` result type (append-only in
both places — matches the task exactly as written; no deviation here, unlike task-001).

## Files created / changed
| File | Change |
|------|--------|
| `packages/protocol/src/messages.ts` | added `model: z.string().optional()` to `agentSessionStatsResponseSchema`'s `payload` object |
| `packages/protocol/src/session-messages.test.ts` | added a test asserting the response parses both with and without `payload.model` |
| `packages/server/src/agent/provider-contract.ts` | added `model?: string` to the `AgentSessionStats` result interface |
| `packages/server/src/agent/slash-command-operations.ts` | `handleSessionStats` now merges `session.getRuntimeInfo().model` into the payload only when `stats.model === undefined` |
| `packages/server/src/agent/slash-command-ops.test.ts` | added two tests: back-fill when stats omit `model`, and preservation when stats already supply one |

## How it satisfies the scope
- `clean-room-scope/features/agent-sessions.md` § Session stats / slash commands: the `/session`
  RPC's payload now includes the model, matching the task's aim of making the periodic stats poll
  (task-004) a self-correcting model source — the daemon computes this server-side so the client
  doesn't need special-case logic beyond reading `payload.model`.
- `clean-room-scope/features/agent-providers.md` § Runtime info: reuses the existing
  `getRuntimeInfo()` contract method (already implemented by both `pi` and `mock` providers) rather
  than adding a new provider method — no `provider-contract.ts` method signature was added, only the
  result-type field.
- Confirmed the `AgentSession` contract already exposes `getRuntimeInfo()` at the
  `handleSessionStats` call site — no contract change was needed there, as anticipated by the task.

## Build & test results
```
$ npx vitest run packages/protocol/src/session-messages.test.ts packages/server/src/agent/slash-command-ops.test.ts
✓ packages/protocol/src/session-messages.test.ts (30 tests) 6ms
✓ packages/server/src/agent/slash-command-ops.test.ts (16 tests) 5ms
Test Files  2 passed (2)
     Tests  46 passed (46)

$ npm run typecheck
> tsc -b
(success, no output)

$ npm run build:protocol
> tsc -b packages/protocol
(success, no output)

$ npm run build:server
> tsc -b packages/server && chmod +x packages/server/dist/daemon/main.js
(success, no output)
```

## Acceptance criteria
- [x] `agent_session_stats_response.payload.model` exists as an optional string; old payloads still
  validate — verified by the new protocol test (`payload: {}` still parses) plus the pre-existing
  "tolerates unknown extra fields" test continuing to pass unmodified.
- [x] `handleSessionStats` returns a `model` when the provider stats omit it, derived from runtime
  info; a provider-supplied model is preserved as-is — verified by the two new
  `slash-command-ops.test.ts` cases.
- [x] `npm run build:protocol`, `npm run build:server`, `npm run typecheck` pass — all green above.

## Follow-ups / TODO(verify)
- None. This task's scope matched the actual codebase state exactly (unlike task-001, no
  investigation-driven deviation was needed).
