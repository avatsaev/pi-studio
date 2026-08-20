# Task 004 — RPC handlers + production bootstrap wiring + disconnect cancellation — Summary

- **Sprint:** sprint-055-provider-auth-rpc
- **Completed:** 2026-08-20
- **Status:** done

## What was implemented

`packages/server/src/agent/provider-auth/provider-auth-rpc.ts` — `registerProviderAuthHandlers`,
registering the five flat `provider_auth_*` types. Each handler defensively coerces wire input
(the router never validates a session message's shape before dispatch) and adds no policy of its
own — every error code, ownership check, and idempotency rule already lives in `ProviderAuthService`
(task-003). An unsupported/missing `authType` is rejected before ever calling the service (required
for type-safe narrowing to `ProviderAuthType`); every other validation — unknown provider, unknown
flowId/promptId, cross-session ownership — is left entirely to the service.

Wired into `packages/server/src/daemon/bootstrap.ts`, next to the existing file-watch/checkout/
extensions construction: `resolvePiAuthPaths(config)` (task-002) feeds `createPiAuthRuntime` (also
task-002), which feeds a `ProviderAuthService` construction, which feeds
`registerProviderAuthHandlers`. Not wired into `dev-bootstrap.ts` — verified by a new test asserting
a dev daemon answers `unknown_message_type` for `provider_auth_list_request`.

## Deviation from the task spec (documented, not silent) — `SessionSubscriptions` ownership

The task's own pseudocode had the RPC layer own the subscription: `provider_auth_login_request`'s
handler was specced to `await service.login(...)`, then on `ok` call
`subscriptions.add(session, key, () => service.cancel(session, flowId))`. **Building exactly that
first exposed a real race, caught by a failing test, not by inspection:**

`ProviderAuthService.login()` returns `{ok, flowId}` immediately and runs the actual login
fire-and-forget (`void this.runFlow(...)`). With a `PiAuthRuntime.login()` that resolves fast
(trivially true of a synchronous fake in tests, and not something a slow real provider is
guaranteed to avoid either — e.g. an already-authenticated OAuth refresh), `runFlow`'s continuation
can settle the flow (and, in the original callback-based design, fire an `onFlowEnded` hook that
removes the subscription entry) *before* the RPC handler's own `await service.login(...)` even
returns. The handler would then `subscriptions.add(...)` an entry for a flow that had *already*
ended — a disposer that is stale from the moment it's created, since nothing else will ever fire to
remove it (the flow map no longer even has that `flowId`). This isn't a hypothetical: the very
first version of the "a flow that completes normally leaves no subscription key behind" test failed
against this design with a real leftover entry.

**Fix:** moved subscription ownership fully into `ProviderAuthService` — the task's own
explicitly-offered alternative ("...or have the service own the `subscriptions` handle — pick one
and keep it single-owner"). `login()` now calls `this.subscriptions?.add(...)` *synchronously*, in
the same stretch of code that creates the flow and *before* `void this.runFlow(...)` is even
invoked; `settleFlow()` calls `this.subscriptions?.remove(...)` as its last step. Both operations
happen inside the service's own synchronous/microtask-ordered control flow — there is no `await`
boundary between "flow exists" and "subscription registered", so the race is closed by
construction, not by timing luck. `provider-auth-rpc.ts` ended up simpler as a direct consequence:
its `ProviderAuthRpcDeps` no longer needs a `subscriptions` field at all — every handler is a pure
pass-through to the service.

One consequence worth naming: `SessionSubscriptions.remove()` re-invokes the disposer it finds
(`() => this.cancel(session, flowId)`), so `settleFlow()` calling `subscriptions.remove()` causes a
harmless re-entrant call back into `cancel()`. It's provably safe and terminates in one extra hop
either way — `this.flows.delete(flow.flowId)` already ran a few lines earlier in the same
`settleFlow()` call, so the re-entrant `cancel()` finds no flow and short-circuits to `{ok:true}`
without touching state again. Documented inline on both `settleFlow()` and the class doc comment.

## Files created / changed

| File | Change |
|------|--------|
| `packages/server/src/agent/provider-auth/provider-auth-rpc.ts` | created |
| `packages/server/src/agent/provider-auth/provider-auth-rpc.test.ts` | created |
| `packages/server/src/agent/provider-auth/provider-auth-service.ts` | modified — `subscriptions` dep replaces the originally-added `onFlowEnded` callback; `login`/`settleFlow` own the `provider_auth_flow:<flowId>` entry directly (see Deviation above); exports `PROVIDER_AUTH_FLOW_KEY_PREFIX` |
| `packages/server/src/agent/provider-auth/provider-auth-service.test.ts` | modified — added a "SessionSubscriptions ownership" suite (8 tests) covering add/remove across every flow-ending path |
| `packages/server/src/daemon/bootstrap.ts` | modified — constructs `PiAuthRuntime`/`ProviderAuthService` and calls `registerProviderAuthHandlers`, production-bootstrap only |
| `packages/server/src/daemon/bootstrap.test.ts` | modified — `boot()` now pins `daemon.piHome` to an isolated temp dir (see Notes); added `provider_auth_list_request` to the full-RPC-surface probe list; added a `provider_auth` describe block (feature flag, list RPC, dev-daemon negative case) |

## Build & test results

```
$ npm run build:server
tsc -b packages/server && chmod +x packages/server/dist/daemon/main.js
(success)

$ npm run clean && npm run typecheck
tsc -b
(success, 0 errors)

$ npx oxlint <all 6 changed files>
(only a pre-existing, unrelated warning in bootstrap.ts — confirmed via `git stash`/re-lint diff:
 present at the same line before this task's changes, just renumbered)

$ npx oxfmt --check <all 6 changed files>
All matched files use the correct format.

$ npx vitest run packages/server/src/agent/provider-auth
Test Files  3 passed (3)
     Tests  53 passed (53)

$ npx vitest run packages/server/src/daemon/bootstrap.test.ts
Test Files  1 passed (1)
     Tests  36 passed (36)

$ npx vitest run packages/server/src   # full server package, confirming no regressions
Test Files  61 passed (61)
     Tests  688 passed (688)
```

New coverage:
- `provider-auth-rpc.test.ts` — 8 tests. "Handler wiring" (fake service): all five types register
  and return documented response envelopes correlated by the router; login args pass through
  exactly (`session, provider, authType`); an unsupported/missing `authType` is rejected before the
  service is ever called; an empty/missing `provider` is coerced and left to the service to reject
  as `unknown_provider` (no RPC-layer second opinion); `respond`/`cancel` coerce missing
  `flowId`/`promptId`/`value` to `""` rather than throwing, and no `rpc_error` is ever emitted for
  malformed input. "End-to-end via the router" (real `ProviderAuthService` + fake `PiAuthRuntime` +
  real `SessionSubscriptions`, wired exactly like `bootstrap.ts`): a login flow started via
  `routeTextFrame`, then `subscriptions.disposeSession()` (the same hook `onSessionClose` fires on
  every real socket close), cancels the flow and empties the subscription key; an explicit
  `provider_auth_cancel_request` removes the key; a flow that completes normally also removes it.
- `provider-auth-service.test.ts`'s new "SessionSubscriptions ownership" suite — 8 tests: the entry
  exists while a flow is in flight; a fast-resolving runtime still leaves no stale entry (the
  regression test for the race described above); explicit `cancel()` removes it; TTL expiry removes
  it; invoking the registered disposer directly (simulating `disposeSession`) cancels the flow; a
  second login superseding the first swaps the entry; the `subscriptions` dep is optional (existing
  callers that don't pass one are unaffected).
- `bootstrap.test.ts` — 3 new tests: `server_info.features.providerAuth === true` over a real direct
  handshake; a production daemon answers `provider_auth_list_request`; a dev daemon (`startDevDaemon`)
  answers `unknown_message_type` for the same type. Also added `provider_auth_list_request` to the
  existing "registers the full RPC surface" probe list.

## Notes on test isolation

`boot()`'s shared config previously only set `daemon.extensions.autoSync: false`. Adding
`provider_auth_list_request` to the RPC-surface probe (and the new dedicated `provider_auth`
describe block) meant every `boot()`-started daemon now constructs a real `PiAuthRuntime` on first
use — which, per `resolvePiAuthPaths`, falls back to Pi's own default `~/.pi/agent` paths when
`daemon.piHome` is unset. Left as-is, these tests would have silently touched the *developer's own*
`~/.pi/agent/auth.json`/`models.json` on every test run. Fixed by pinning `boot()`'s config to a
fresh `daemon.piHome` temp directory (mirrors `pi-auth-runtime.test.ts`'s existing "fresh machine"
isolation pattern) — every `provider_auth_*` RPC exercised through `boot()` now only ever touches a
disposable directory. Live Pi-runtime E2E against a real `~/.pi` (or an explicitly staged one)
remains task-005's deliberately separate job.

## Acceptance criteria

- [x] All five types are registered and reachable through `routeTextFrame`, each returning its
      documented response with `requestId` correlated by the router.
- [x] A login flow started over the router and then followed by a session close is cancelled:
      `subscriptions.disposeSession(session)` triggers the flow's terminal `done { ok: false,
      error: "cancelled" }` and empties the flow registry.
- [x] An explicit `provider_auth_cancel_request` removes the subscription key (no stale disposer
      remains for that flow).
- [x] A flow that completes normally also leaves no subscription key behind.
- [x] Malformed input (missing `provider`, bogus `authType`, missing `flowId`) yields
      `{ ok: false, error: ... }` responses, never a thrown `handler_error`.
- [x] The handlers are registered by `bootstrap.ts` and **not** by `dev-bootstrap.ts`; a dev daemon
      answers `unknown_message_type` for `provider_auth_list_request`.
- [x] `server_info.features.providerAuth === true` on a production daemon (direct handshake path).

## Follow-ups / TODO(verify)

- None outstanding for this task's own scope. Live E2E against a real Pi runtime + docs sync is
  task-005's job, and should reference this task's `SessionSubscriptions`-ownership deviation when
  it does its own pass over `swe/features/provider-auth-rpc.md`.
