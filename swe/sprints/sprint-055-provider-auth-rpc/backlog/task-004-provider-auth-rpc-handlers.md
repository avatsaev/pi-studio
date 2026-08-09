# Task 004 — RPC handlers + production bootstrap wiring + disconnect cancellation

- **Sprint:** sprint-055-provider-auth-rpc
- **Status:** backlog
- **Type:** feature
- **Area:** packages/server (agent/provider-auth, daemon/bootstrap)
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** task-001, task-003

## Goal

Expose `ProviderAuthService` on the wire: register the five handlers, construct the service in the
production bootstrap, and make a dropped socket cancel its in-flight login flow.

## Context / why

This is the thin adapter between the router and the service. Two details make it non-mechanical:

1. **Disconnect cancellation is free if wired correctly.** `SessionSubscriptions`
   (`packages/server/src/ws/session-subscriptions.ts`) already holds per-session disposers and is
   already drained on socket close via the ws-server session-close hook → `disposeSession()`.
   Registering the flow's cancel under a namespaced key (`provider_auth_flow:<flowId>`) is the
   entire mechanism — no new lifecycle plumbing, no ws-server change.
2. **Production bootstrap only.** `daemon/dev-bootstrap.ts` deliberately does not register
   file-watch or checkout handlers, and must not register this family either. The dev daemon is the
   mock-provider, minimal-handler daemon; an unregistered type already answers `unknown_message_type`
   (`ws/router.ts:74`). No `if (dev)` branch anywhere in the service.

## Scope references

- `swe/features/provider-auth-rpc.md` § Public Contract (RPC table), § New/changed files,
  § Error Handling & Edge Cases (dev-daemon row)
- `packages/server/src/files/file-watch-rpc.ts` — **the pattern to copy** (`registerXHandlers(registry,
  deps)`, `subscriptions.add(session, key, unsub)`, `{ ok, error }` response payloads)
- `packages/server/src/projects/git-checkout-rpc.ts` — sibling service+rpc pairing
- `packages/server/src/ws/router.ts` — `HandlerRegistry.register`, response wrapping (86-94)
- `packages/server/src/ws/session-subscriptions.ts` — `add` / `remove` / `disposeSession`
- `packages/server/src/daemon/bootstrap.ts` — service construction + registration site
- Create: `packages/server/src/agent/provider-auth/provider-auth-rpc.ts` (+ `.test.ts`)

## What to build

`registerProviderAuthHandlers(registry, deps)` where
`deps = { providerAuthService, subscriptions, logger? }`, registering exactly five flat names:

| Type | Handler behavior |
|------|------------------|
| `provider_auth_list_request` | `{ type: "provider_auth_list_response", payload: await service.listProviders() }` |
| `provider_auth_login_request` | Calls `service.login(ctx.session, provider, authType)`; on `ok`, `subscriptions.add(session, "provider_auth_flow:"+flowId, () => service.cancel(session, flowId))` |
| `provider_auth_respond_request` | `service.respond(session, flowId, promptId, value)` |
| `provider_auth_cancel_request` | `service.cancel(session, flowId)`; also `subscriptions.remove(...)` |
| `provider_auth_logout_request` | `await service.logout(provider)` |

- Handlers return the response object **without** `requestId` — the router stamps it
  (`ws/router.ts:86-94`).
- Validate/coerce incoming fields defensively (`String(ctx.message.provider ?? "")`) like
  `file-watch-rpc.ts` does; an invalid `authType` is `{ ok:false, error:"unsupported_auth_type" }`,
  not a throw.
- The service must also remove the subscription key when a flow ends on its own, so a completed
  flow leaves no stale disposer (expose a small callback or have the service own the
  `subscriptions` handle — pick one and keep it single-owner).

Wire in `packages/server/src/daemon/bootstrap.ts` next to the existing file-watch/checkout
construction: build the `PiAuthRuntime` from `resolvePiAuthPaths(config)` (task-002), build the
service, call `registerProviderAuthHandlers`. Nothing in `dev-bootstrap.ts`.

## Out of scope

- Flow semantics (task-003 owns them; handlers must add no policy).
- Protocol schemas (task-001).
- Client SDK / UI.

## Acceptance criteria

- [ ] All five types are registered and reachable through `routeTextFrame`, each returning its
      documented response with `requestId` correlated by the router.
- [ ] A login flow started over the router and then followed by a **session close** is cancelled:
      `subscriptions.disposeSession(session)` triggers the flow's terminal
      `done { ok: false, error: "cancelled" }` and empties the flow registry.
- [ ] An explicit `provider_auth_cancel_request` removes the subscription key (no stale disposer
      remains for that flow).
- [ ] A flow that completes normally also leaves no subscription key behind.
- [ ] Malformed input (missing `provider`, bogus `authType`, missing `flowId`) yields
      `{ ok: false, error: ... }` responses, never a thrown `handler_error`.
- [ ] The handlers are registered by `bootstrap.ts` and **not** by `dev-bootstrap.ts`; a dev daemon
      answers `unknown_message_type` for `provider_auth_list_request`.
- [ ] `server_info.features.providerAuth === true` on a production daemon (direct handshake path).

## Test / verification plan

- Build: `npm run build:server` succeeds.
- Typecheck: `npm run typecheck` succeeds.
- Lint/format: `npx oxlint <changed files>`, `npx oxfmt --check <changed files>` clean.
- Tests: `packages/server/src/agent/provider-auth/provider-auth-rpc.test.ts` driving real
  `routeTextFrame` against a fake `Session` (the `router.test.ts` harness) with a real
  `SessionSubscriptions` and a fake service — assert registration, response shapes, subscription
  add/remove, and the disposeSession path. Add a `bootstrap.test.ts` assertion that a running
  production daemon answers `provider_auth_list_request` and advertises the feature flag, and a
  `dev-bootstrap` assertion that it does not. Run `npx vitest run packages/server/src`; all pass.

## Notes

- Keep the key prefix (`provider_auth_flow:`) namespaced — `SessionSubscriptions` is deliberately
  domain-agnostic and shared with `file_watch:` / `checkout_status:`.
- Single-owner rule for the subscription handle avoids the classic double-remove bug; state the
  choice in a comment.
- The service is constructed once per daemon; the runtime inside it stays lazy (task-002), so
  bootstrap cost is unchanged.
