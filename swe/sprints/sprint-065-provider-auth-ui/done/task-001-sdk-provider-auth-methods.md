# Task 001 — `PiStudioClient` provider-auth methods + flow correlation

- **Sprint:** sprint-065-provider-auth-ui
- **Status:** done
- **Type:** feature
- **Area:** client / SDK facade
- **Priority:** P1
- **Estimated size:** M
- **Depends on:** sprint-055 (all five tasks — this consumes its wire contract)

## Goal
Add the four provider-auth methods to `PiStudioClient` so any client drives a remote login through a
callback interface, with flowId/promptId correlation entirely invisible to callers.

## Context / why
Sprint-055 inverts Pi's `AuthInteraction` onto the socket: `notify` becomes a per-session push,
`prompt` becomes a correlated request/response, `signal` becomes a cancel RPC. That is the right
shape for a daemon but the wrong shape for a UI, which wants "call login, get asked questions,
get a result". This task is that adapter — and it is the **only** place provider-auth wire messages
may be constructed, because raw WebSocket use outside the SDK is a standing project rule.

No `DaemonClient` change is needed: `request<T>(type, params, timeoutMs?)`, `onSessionMessage(handler)`
and `hasFeature(flag)` already exist and are exactly the three seams required.

## Scope references
- `swe/features/provider-auth-ui.md` § Public Contract (SDK), § Behavior & Algorithms, § Error Handling
- `swe/features/provider-auth-rpc.md` § Public Contract (the five request/response pairs, the
  `provider_auth_flow_event` push, `ProviderAuthInfo`)
- `packages/client/src/pistudio-client.ts` (facade; `listExtensionPacks`/`setExtensionPacks` are the
  precedent for flat methods living directly on the facade)
- `packages/client/src/daemon-client.ts` (`request`, `onSessionMessage`, `hasFeature`, `RpcTimeoutError`)
- `packages/client/src/pistudio-client.test.ts` (`makeScriptedDaemon()` / `makeFacade()` harness)
- `packages/client/src/index.ts` (export surface for the new types)

## What to build
- Local TypeScript types (this family rides the `sessionMessageBaseSchema` passthrough — **no**
  protocol-package schema): `ProviderAuthInfo`, `ProviderAuthFlowUiEvent`, `ProviderAuthPromptUi`,
  `ProviderAuthCallbacks`, plus a type guard for the push, mirroring how `TimelineHandle.subscribe`
  narrows `agent_stream` and how web-client's `isCheckoutStatusUpdate` narrows its own push.
- Methods on `PiStudioClient`:
  - `listProviderAuth(): Promise<ProviderAuthInfo[]>` — `provider_auth_list_request`; a payload-level
    `{ ok: false, error }` throws a typed error (domain failures are payloads in this family, never
    `rpc_error`).
  - `loginProvider(provider, authType, callbacks, opts?): Promise<{ ok: boolean; error?: string }>`
  - `logoutProvider(provider): Promise<{ stillConfigured?: boolean }>`
  - `hasProviderAuthCapability(): boolean` → `daemon.hasFeature("providerAuth")`.
- `loginProvider` mechanics:
  - **Subscribe to `onSessionMessage` *before* sending `provider_auth_login_request`, and buffer
    events until the response's `flowId` is known.** The daemon starts the Pi flow immediately, so a
    `prompt` or `auth_url` event can legitimately arrive before the login response is processed;
    subscribing after the await drops it and the dialog hangs forever.
  - Filter to the active `flowId`; events for any other/stale flow are dropped silently.
  - `kind: "prompt"` → `await callbacks.prompt(p)` → `provider_auth_respond_request`
    `{ flowId, promptId, value }`. A rejection from `callbacks.prompt` cancels the flow.
  - `kind: "prompt_cancelled"` with the matching `promptId` → reject the pending prompt promise
    (out-of-band resolution: an OAuth callback won the race).
  - All other kinds → `callbacks.onEvent(e)`.
  - `opts.signal` abort → `provider_auth_cancel_request`; the returned promise still settles from the
    terminal `done` event.
  - Settles on `done`. Socket close before `done` → resolve `{ ok: false, error: "connection_lost" }`
    (never hang, never reject for a disconnect).
  - Exactly one active flow per client instance; a second call rejects locally with a clear message,
    mirroring the server rule.
  - Unsubscribe and clear all state on settle, whichever path settles it.

## Out of scope
- Any UI (tasks 003–006), any protocol-package change, any `DaemonClient` change.
- CLI remote (`--host`) login — a documented follow-up reusing this same surface.
- Retry/resume of a dead flow: flows die with the socket, by design.

## Acceptance criteria
- [ ] All four methods exist on `PiStudioClient`, fully typed, with the new types exported from
      `packages/client/src/index.ts`.
- [ ] Secret-prompt round-trip: scripted daemon emits `prompt(secret)`, `callbacks.prompt` resolves,
      a `provider_auth_respond_request` carrying that value is sent, `done ok:true` settles the promise.
- [ ] A flow event delivered **before** the login response is buffered and still reaches the caller
      (regression lock for the subscribe-first rule).
- [ ] `prompt_cancelled` rejects the pending prompt promise; the flow continues and its later `done`
      settles the call.
- [ ] `opts.signal` abort sends `provider_auth_cancel_request`; the promise settles from `done ok:false`.
- [ ] Socket drop mid-flow settles `{ ok:false, error:"connection_lost" }` — no hang, no unhandled rejection.
- [ ] Events for an unknown/stale `flowId` are dropped with no callback invocation.
- [ ] A second concurrent `loginProvider` rejects locally without sending a second login request.
- [ ] `hasProviderAuthCapability()` is `false` against a `server_info` fixture without the flag, and
      no provider-auth RPC is sent when it is false.
- [ ] Every subscription is released once the flow settles (asserted via handler count or a spy).

## Test / verification plan
- Tests: extend `packages/client/src/pistudio-client.test.ts` using the existing
  `makeScriptedDaemon()`/`makeFacade()` harness (injected fake transport, `fake.push()` to inject
  flow events, `fake.drop()` for the disconnect case). Run
  `npx vitest run packages/client/src/pistudio-client.test.ts` — all pass.
- Build: `npm run build:client` succeeds.
- Typecheck: `npm run typecheck` succeeds (run `npm run clean` first if a signature change appears to
  typecheck suspiciously clean — incremental `.tsbuildinfo` has bitten this repo before).
- Lint/format: `npm run lint`, `npx oxfmt <changed files>`.

## Notes
- Prompt values are secrets: never log them, never include them in an error message, never echo them
  back through `onEvent`. The only place a value travels is the `provider_auth_respond_request` payload.
- Use the default `rpcTimeoutMs` for the four RPCs — they are all immediate acknowledgements. The
  long wait is the flow itself, which is event-driven and bounded by the daemon's 10-minute TTL, not
  by an RPC timeout.
