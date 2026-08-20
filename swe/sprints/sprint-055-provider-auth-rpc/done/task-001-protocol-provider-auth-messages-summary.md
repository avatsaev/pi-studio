# Task 001 — Protocol: provider-auth RPC schemas + `providerAuth` feature flag — Summary

- **Sprint:** sprint-055-provider-auth-rpc
- **Completed:** 2026-08-20
- **Status:** done

## What was implemented

`packages/protocol/src/messages.ts` — the five provider-auth request/response schema pairs,
following the `agentRewindRequestSchema`/`agentRewindResponseSchema` pattern (`.object({...})
.passthrough()`, response bodies wrapped in `payload`):

- `providerAuthTypeSchema` — `z.enum(["api_key", "oauth"])`.
- `providerAuthInfoSchema` — `{ id, name, authTypes, oauthLoginLabel?, oauthIsSubscription?,
  configured: boolean | "unknown", configuredType?, configuredSource? }`.
- `provider_auth_list_request` / `_response` (`payload: { ok, providers, error? }`)
- `provider_auth_login_request` (`{ provider, authType }`) / `_response`
  (`payload: { ok, flowId?, error? }`)
- `provider_auth_respond_request` (`{ flowId, promptId, value }`) / `_response`
  (`payload: { ok, error? }`)
- `provider_auth_cancel_request` (`{ flowId }`) / `_response` (`payload: { ok }`)
- `provider_auth_logout_request` (`{ provider }`) / `_response`
  (`payload: { ok, stillConfigured?, error? }`)

All ten registered in `sessionMessageSchema`'s discriminated union, all `z.infer` types exported. A
code comment above the block states explicitly that `provider_auth_flow_event` is deliberately
**not** a union member — it rides `sessionMessageBaseSchema`'s passthrough fallback, exactly like
`checkout_status_update`/`file_changed` — so a later reader does not "fix" the omission.

`packages/protocol/src/client-capabilities.ts` — added `providerAuth: "providerAuth"` to
`SERVER_FEATURES` (now 8 keys) and its `SERVER_FEATURE_COMPAT` entry, matching the
`extensionPacks` precedent. No emission code needed: `ws-server.ts`'s `defaultFeatures()` already
folds every `SERVER_FEATURES` value into `server_info.features`.

## Files created / changed

| File | Change |
|------|--------|
| `packages/protocol/src/messages.ts` | modified — 10 new schemas + union entries |
| `packages/protocol/src/client-capabilities.ts` | modified — `providerAuth` feature flag + COMPAT entry |
| `packages/protocol/src/session-messages.test.ts` | modified — new `describe("provider auth (sprint-055)")` block |
| `packages/protocol/src/client-capabilities.test.ts` | modified — exact-key-set assertion updated to include `providerAuth` |

## How it satisfies the scope

Maps to `swe/features/provider-auth-rpc.md` § Public Contract (RPC messages table,
`ProviderAuthInfo`), § Registration style, § Error convention. Every response payload requires
`ok`; domain failures travel as `{ ok: false, error: "<reason>" }`, never a chosen `rpc_error`
code — consistent with the verified router convention (only `unknown_message_type` /
`handler_error` exist, both reserved for transport-level failures). No deviation from the task
spec.

## Build & test results

```
$ npm run build:protocol
tsc -b packages/protocol
(success)

$ npm run clean && npm run typecheck
tsc -b
(success, 0 errors)

$ npx oxlint packages/protocol/src/messages.ts packages/protocol/src/client-capabilities.ts \
    packages/protocol/src/session-messages.test.ts packages/protocol/src/client-capabilities.test.ts
(only pre-existing warnings, confirmed via git-stash diff to predate this task: unused agent-*
schema imports in session-messages.test.ts, Array#sort() in client-capabilities.test.ts — none on
lines this task touched)

$ npx oxfmt --check packages/protocol/src/messages.ts packages/protocol/src/client-capabilities.ts \
    packages/protocol/src/session-messages.test.ts packages/protocol/src/client-capabilities.test.ts
All matched files use the correct format.

$ npx vitest run packages/protocol/src
Test Files  10 passed (10)
     Tests  99 passed (99)
```

`session-messages.test.ts`'s new `describe("provider auth (sprint-055)")` block (5 `it` cases)
covers: all ten types parse
through `sessionMessageSchema`; every response schema requires `ok` (missing `ok` fails, present
`ok` passes) across all five response schemas; `providerAuthInfoSchema` accepts `configured: true
/false/"unknown"` and rejects `"yes"`/`1`; every new schema round-trips an unknown extra field
(`.passthrough()`); and `provider_auth_flow_event` fails `sessionMessageSchema` directly (proving
it is not a union member) but validates through `sessionEnvelopeSchema` via the passthrough
fallback.

## Acceptance criteria

- [x] All ten schemas exist, are exported with their inferred types, and are members of
      `sessionMessageSchema`.
- [x] Each response schema requires `ok` and accepts an optional `error`; a payload missing `ok`
      fails validation.
- [x] `providerAuthInfoSchema` accepts `configured: true`, `false`, and `"unknown"`, and rejects
      any other value.
- [x] Unknown extra fields survive a parse round-trip on every new schema (`.passthrough()`).
- [x] `SERVER_FEATURES.providerAuth` and its `SERVER_FEATURE_COMPAT` entry exist; the exact-key-set
      assertion in `client-capabilities.test.ts` is updated to include it.
- [x] A `{ type: "provider_auth_flow_event", ... }` message still validates through
      `sessionEnvelopeSchema` via the passthrough fallback (proving no union entry is needed).

## Follow-ups / TODO(verify)

- None outstanding for this task's own scope. The server-side runtime seam, flow service, RPC
  handlers, and bootstrap wiring are tasks 002–004; the flow-event push's client-side consumption
  belongs to `features/provider-auth-ui.md` (a later sprint).
