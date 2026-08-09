# Task 001 — Protocol: provider-auth RPC schemas + `providerAuth` feature flag

- **Sprint:** sprint-055-provider-auth-rpc
- **Status:** backlog
- **Type:** feature
- **Area:** packages/protocol (wire contract)
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** none

## Goal

Add the five provider-auth request/response schema pairs to the wire contract, plus the
`providerAuth` server-feature flag, so the daemon (task-004) and any client can speak the family.

## Context / why

The daemon-side auth flow needs a durable, multi-client RPC surface: list providers, start a login
flow, answer a prompt, cancel, log out. Unlike the per-session push (`provider_auth_flow_event`,
which rides the passthrough fallback), these are correlated request/response pairs that a typed SDK
will consume, so they get real Zod schemas and union membership.

**The error convention is load-bearing and non-obvious.** `packages/server/src/ws/router.ts`
emits only two `rpc_error` codes — `unknown_message_type` (line 74) and `handler_error` (line 109)
— from a **module-private** `sendRpcError` (line 57). A handler *cannot* choose a code. So every
domain failure in this family travels in the response payload as `{ ok: false, error: "<reason>" }`,
exactly like `file_watch_subscribe_response`'s `{ ok: false, error: "too_many_watches" }`
(`packages/server/src/files/file-watch-rpc.ts:55-60`). Schemas must make `ok` required.

## Scope references

- `swe/features/provider-auth-rpc.md` § Public Contract (RPC messages table, `ProviderAuthInfo`),
  § Registration style, § Error convention
- `swe/architecture/websocket-protocol.md` § RPC naming, § Capability flags
- `packages/protocol/src/messages.ts` — schemas + `sessionMessageSchema` union (line 839),
  `sessionMessageBaseSchema` (line 896)
- `packages/protocol/src/client-capabilities.ts` — `SERVER_FEATURES` (line 39),
  `SERVER_FEATURE_COMPAT` (line 56)
- `packages/protocol/src/client-capabilities.test.ts` — asserts the **exact** `SERVER_FEATURES` key
  set; it will fail until updated
- `packages/protocol/src/session-messages.test.ts` — per-schema round-trip test conventions

## What to build

Modify `packages/protocol/src/messages.ts`, following the `agentRewindRequestSchema` /
`agentRewindResponseSchema` pattern at lines 402-427 (`.object({...}).passthrough()` + exported
`z.infer` type; responses wrap their body in `payload`):

- `providerAuthInfoSchema` — `{ id, name, authTypes: ("api_key"|"oauth")[], oauthLoginLabel?,
  oauthIsSubscription?, configured: boolean | "unknown", configuredType?, configuredSource? }`.
  `configured` is a union because a bounded `checkAuth()` can time out (task-002).
- Five pairs, all flat snake_case, all `.passthrough()`, every response `payload` carrying
  `ok: boolean` and optional `error: string`:
  - `provider_auth_list_request` / `_response` (`payload: { ok, providers, error? }`)
  - `provider_auth_login_request` (`{ provider, authType }`) / `_response`
    (`payload: { ok, flowId?, error? }`)
  - `provider_auth_respond_request` (`{ flowId, promptId, value }`) / `_response`
    (`payload: { ok, error? }`)
  - `provider_auth_cancel_request` (`{ flowId }`) / `_response` (`payload: { ok }`)
  - `provider_auth_logout_request` (`{ provider }`) / `_response`
    (`payload: { ok, stillConfigured?, error? }`)
- Register all ten in the `sessionMessageSchema` discriminated union.
- Export every `z.infer` type.

Modify `packages/protocol/src/client-capabilities.ts`:

- Add `providerAuth: "providerAuth"` to `SERVER_FEATURES` (camelCase, matching `checkoutRefresh`).
- Add its `SERVER_FEATURE_COMPAT` entry with the same `COMPAT({...})` shape as its siblings.

No emission code is needed — `ws-server.ts`'s `defaultFeatures()` and `bootstrap.ts`'s relay path
both fold every `SERVER_FEATURES` value into `server_info.features` automatically.

**Do NOT** add a schema for `provider_auth_flow_event`: it is a per-session push and rides
`sessionMessageBaseSchema`'s passthrough fallback, like `checkout_status_update` and `file_changed`.
A comment in `messages.ts` should say so, so a later reader does not "fix" the omission.

## Out of scope

- Any server handler, service, or bootstrap wiring (tasks 002-004).
- Client SDK types or UI (that is `features/provider-auth-ui.md`, a separate sprint).
- The flow-event push schema (deliberately passthrough — see above).

## Acceptance criteria

- [ ] All ten schemas exist, are exported with their inferred types, and are members of
      `sessionMessageSchema`.
- [ ] Each response schema **requires** `ok` and accepts an optional `error`; a payload missing
      `ok` fails validation.
- [ ] `providerAuthInfoSchema` accepts `configured: true`, `false`, and `"unknown"`, and rejects
      any other value.
- [ ] Unknown extra fields survive a parse round-trip on every new schema (`.passthrough()`).
- [ ] `SERVER_FEATURES.providerAuth` and its `SERVER_FEATURE_COMPAT` entry exist; the exact-key-set
      assertion in `client-capabilities.test.ts` is updated to include it.
- [ ] A `{ type: "provider_auth_flow_event", ... }` message still validates through
      `sessionEnvelopeSchema` via the passthrough fallback (proving no union entry is needed).

## Test / verification plan

- Build: `npm run build:protocol` succeeds.
- Typecheck: `npm run typecheck` succeeds.
- Lint/format: `npx oxlint <changed files>` and `npx oxfmt --check <changed files>` clean.
- Tests: extend `packages/protocol/src/session-messages.test.ts` (round-trip + rejection cases for
  each new pair, the `configured` union, the passthrough-fallback case for the flow event) and
  update `packages/protocol/src/client-capabilities.test.ts`. Run
  `npx vitest run packages/protocol/src`; all pass.

## Notes

- Append-only rule: these are all new optional-tolerant schemas; nothing existing is narrowed.
- Response bodies go under `payload`, matching `agentRewindResponseSchema` — the router stamps
  `requestId` at the top level, so handlers must not set it (`ws/router.ts:86-94`).
- Naming: flat snake_case is the dominant convention; do not use a dotted name here.
