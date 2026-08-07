# Task 005 — Tool-call permission flow + question bridge — Summary

- **Sprint:** sprint-006-agent-sessions-timeline
- **Completed:** 2026-06-11
- **Status:** done

## What was implemented
`packages/server/src/agent/permissions.ts` — `PermissionService` + `PermissionStore`:
- `requestPermission(req, getSessions)` — creates a `LivePermission`, broadcasts `agent_permission_request`, and returns `{ requestId, decision: Promise }`.
- `handleRespond` — first resolution wins; resolves the promise, broadcasts `agent_permission_resolved`; second call returns `resolved:false`.
- Question bridge: if the resolved permission has `allowComment:true`, auto-finds and resolves a pending `questionKind:"input"` for the same agent with the supplied comment or empty string.
- `cancelPending(agentId)` — cancels all pending permissions for an agent with `decision:"canceled"` (called on interrupt).
- `globalPermissionStore` singleton; tests inject a fresh `PermissionStore`.
- Handlers registered as `agent.permission.respond.request` with legacy alias `respond_to_permission`.

## Files created / changed
| File | Change |
|------|--------|
| `agent/permissions.ts` | created |
| `agent/index.ts` | modified |
| `agent/permissions.test.ts` | added — 5 tests |

## Acceptance criteria
- [x] A tool call in ask-mode emits `agent_permission_request` and pauses the turn (awaits `decision`).
- [x] Responding resolves it and broadcasts `agent_permission_resolved`; first resolution wins.
- [x] Full-access mode produces no permission requests (caller never invokes `requestPermission`).
- [x] A Pi `select`+allowComment dialog is one question and auto-resolves the follow-up input.
- [x] Interrupting a turn cancels its pending requests (`cancelPending`).
