# Task 001 — `PiStudioClient` provider-auth methods + flow correlation — Summary

- **Sprint:** sprint-065-provider-auth-ui
- **Status:** done
- **Completed:** 2026-08-20

## What was built

All four provider-auth methods on `PiStudioClient` (`packages/client/src/pistudio-client.ts`), plus
the local types/type-guard this family needs since it has no protocol-package push schema:

- `hasProviderAuthCapability()` → `daemon.hasFeature("providerAuth")`.
- `listProviderAuth(): Promise<ProviderAuthInfo[]>` — throws `ProviderAuthError` on a payload-level
  `ok:false` (never silently returns an empty list for a real failure).
- `logoutProvider(provider): Promise<{ stillConfigured?: boolean }>` — same `ProviderAuthError`
  convention.
- `loginProvider(provider, authType, callbacks, opts?): Promise<ProviderAuthLoginResult>` — the flow
  driver. Subscribes to `onSessionMessage` *before* sending `provider_auth_login_request` and buffers
  any `provider_auth_flow_event` that arrives before the response's `flowId` is known, draining the
  buffer (filtered to the now-known `flowId`) the instant it resolves. Routes `prompt` through
  `callbacks.prompt()` (raced against an out-of-band `prompt_cancelled` for the same `promptId`),
  everything else through `callbacks.onEvent()`, and settles exactly once — from a terminal `done`
  event, an immediate login rejection, `opts.signal` abort (still settles from the daemon's `done`),
  or a dropped connection (`{ ok:false, error:"connection_lost" }`, detected via `onStateChange`
  `"closed"`, independent of whether an RPC happened to be in flight). Exactly one flow may run per
  client instance; a concurrent second call rejects locally with no RPC sent. `settleProviderAuthFlow`
  is the single idempotent cleanup path — every subscription (session messages, state changes, the
  abort listener) is released exactly once, whichever path settles the flow.
- New types: `ProviderAuthFlowEventPush` + `isProviderAuthFlowEvent()` type guard (the push has no
  protocol schema — rides `sessionMessageBaseSchema`'s passthrough fallback, per
  `swe/features/provider-auth-rpc.md` § Registration style), `ProviderAuthNotifyEvent`,
  `ProviderAuthFlowUiEvent` (the 7-kind exhaustive union task-002's reducer consumes),
  `ProviderAuthPromptUi`, `ProviderAuthCallbacks`, `ProviderAuthLoginOptions`,
  `ProviderAuthLoginResult`, `ProviderAuthError`. `ProviderAuthInfo`/`ProviderAuthType` are imported
  from `@av-pi-studio/protocol` (sprint-055 already defines real schemas for those two).
- No `DaemonClient` change — `request()`, `onSessionMessage()`, `onStateChange()`, `hasFeature()` were
  exactly the seams needed, confirmed by implementation.
- No `packages/client/src/index.ts` change — it already wildcard re-exports `pistudio-client.js`, so
  every new type/method is live on the public surface automatically.

## Files changed

| File | Change |
|---|---|
| `packages/client/src/pistudio-client.ts` | +371 lines: provider-auth types, the private
`ActiveProviderAuthFlow` driver state, and the four public methods + five private helpers |
| `packages/client/src/pistudio-client.test.ts` | +356 lines: harness extended with a configurable
`features` option, a `drop()` socket-close simulator, and a `provider_auth_*`-prefix bypass on the
auto-reply switch (real flows are ordering-sensitive; these tests drive every response manually via
`fake.push()`); 12 new tests under "PiStudioClient — provider auth remote login (sprint-065/task-001)" |

## Commands run + results

- `npm run build:client` → clean, both before and after the format pass.
- `npx vitest run packages/client/src/pistudio-client.test.ts` → **30/30 pass** (18 pre-existing +
  12 new).
- `npm run clean && npm run typecheck` → clean (forced full rebuild per the repo's stale-`.tsbuildinfo`
  caution after a signature change).
- `npx oxlint packages/client/src/pistudio-client.ts packages/client/src/pistudio-client.test.ts` →
  clean (one `consistent-function-scoping` warning on the first pass, fixed by hoisting the
  microtask-flush helper to module scope).
- `npx oxfmt --check packages/client/src/pistudio-client.ts packages/client/src/pistudio-client.test.ts`
  → all matched files already correctly formatted.
- `npm run build` (full monorepo) → clean.
- `npm run typecheck` (full monorepo) → clean.
- `npm run lint` (full monorepo) → clean on both changed files; all reported warnings are pre-existing
  and in unrelated files.
- `npm test` (full monorepo) → **2079/2079 pass** across 166 files (was 2067/165 before this task —
  net +12 tests, +0 files, consistent with extending an existing test file).

## Acceptance criteria

- [x] All four methods exist on `PiStudioClient`, fully typed, with the new types exported from
      `packages/client/src/index.ts` (via its existing `pistudio-client.js` wildcard re-export).
- [x] Secret-prompt round-trip: scripted daemon emits `prompt(secret)`, `callbacks.prompt` resolves,
      a `provider_auth_respond_request` carrying that value is sent, `done ok:true` settles the
      promise.
- [x] A flow event delivered **before** the login response is buffered and still reaches the caller.
- [x] `prompt_cancelled` retires the pending prompt out of band; the flow continues and its later
      `done` settles the call (a stale/non-matching id is a no-op).
- [x] `opts.signal` abort sends `provider_auth_cancel_request`; the promise settles from
      `done ok:false`.
- [x] Socket drop mid-flow settles `{ ok:false, error:"connection_lost" }` — no hang, no unhandled
      rejection.
- [x] Events for an unknown/stale `flowId` are dropped with no callback invocation.
- [x] A second concurrent `loginProvider` rejects locally without sending a second login request.
- [x] `hasProviderAuthCapability()` is `false` against a `server_info` fixture without the flag, and
      no provider-auth RPC is sent when it is false.
- [x] Every subscription is released once the flow settles (asserted directly via
      `sessionHandlers`/`stateHandlers` `Set` size before/after).

## Notes / follow-ups

- Test-harness note for whoever picks up task-004/005: `fake.push()` for `provider_auth_*` responses
  must be driven manually — the shared harness deliberately does **not** auto-reply to that prefix.
- No `TODO(verify)` introduced by this task.
