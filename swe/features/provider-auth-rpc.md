# Provider Auth — Daemon RPC Surface (server side)

> Part of: [MAIN-SCOPE.md](../MAIN-SCOPE.md)
> Related scopes: [provider-auth-cli.md](provider-auth-cli.md) (independent sibling),
> [provider-auth-ui.md](provider-auth-ui.md) (consumer of this contract),
> [agent-providers.md](agent-providers.md),
> [../architecture/websocket-protocol.md](../architecture/websocket-protocol.md),
> [../architecture/config.md](../architecture/config.md),
> [../architecture/auth-security.md](../architecture/auth-security.md)

## Purpose

CLI-local login ([provider-auth-cli.md](provider-auth-cli.md)) only helps when the user has a shell
on the daemon's machine. Web-client users — especially over the relay to a remote/headless daemon —
cannot run it, yet credentials **must** land on the daemon host, because that is where
`pi --mode rpc` subprocesses spawn and read `auth.json`.

This scope defines the **entire server side**: protocol messages, daemon service, and RPC handlers
that let any connected client enumerate provider auth state and drive a Pi login flow remotely. The
key insight making this thin: Pi's `AuthInteraction` callback contract
(`prompt(): Promise<string>` + `notify(): void`) maps 1:1 onto our session envelope — `notify` →
per-session push, `prompt` → correlated request/response, `signal` → cancel RPC.

**No UI or SDK work in this scope** — [provider-auth-ui.md](provider-auth-ui.md) consumes the
contract defined here. Deliverable is verifiable with protocol-level tests against the daemon alone.

## Public Contract

### RPC messages (flat snake_case, append-only, wrapped in the `session` envelope)

All responses carry `{ ok: boolean, error?: string }` — domain failures are payload-level, never a
chosen `rpc_error` code (see § Error convention).

| Message | Direction | Payload | Notes |
|---------|-----------|---------|-------|
| `provider_auth_list_request` | C→S | `{}` | |
| `provider_auth_list_response` | S→C | `{ ok, providers: ProviderAuthInfo[], error? }` | `ok:false, error:"provider_auth_unavailable"` when the Pi runtime cannot be constructed |
| `provider_auth_login_request` | C→S | `{ provider: string, authType: "api_key" \| "oauth" }` | Starts a flow |
| `provider_auth_login_response` | S→C | `{ ok, flowId?: string, error? }` | Immediate; progress arrives as flow events. `error` ∈ `unknown_provider` \| `unsupported_auth_type` \| `provider_auth_unavailable` |
| `provider_auth_respond_request` | C→S | `{ flowId, promptId, value: string }` | Answers a pending prompt |
| `provider_auth_respond_response` | S→C | `{ ok, error? }` | `error: "not_found"` for unknown/stale/not-owned flow or promptId |
| `provider_auth_cancel_request` | C→S | `{ flowId }` | Aborts the flow |
| `provider_auth_cancel_response` | S→C | `{ ok }` | Idempotent — `ok:true` even if the flow was already gone |
| `provider_auth_logout_request` | C→S | `{ provider: string }` | |
| `provider_auth_logout_response` | S→C | `{ ok, stillConfigured?: boolean, error? }` | `stillConfigured` flags an ambient env-var credential surviving removal |

```ts
interface ProviderAuthInfo {
  id: string;                       // Pi provider id
  name: string;                     // display name
  authTypes: ("api_key" | "oauth")[];
  oauthLoginLabel?: string;         // e.g. "Sign in with Claude subscription"
  oauthIsSubscription?: boolean;
  configured: boolean | "unknown";  // "unknown" = checkAuth() exceeded its bound (sprint-054 precedent)
  configuredType?: "api_key" | "oauth";
  configuredSource?: string;        // e.g. env var name — never the secret itself
}
```

### Flow-event push (per-session `send()`, NOT broadcast)

Follows the established `checkout_status_update` / `file_changed` per-session push convention:

```ts
type ProviderAuthFlowEvent = { type: "provider_auth_flow_event"; flowId: string; event:
  | { kind: "info";        message: string; links?: { url: string; label?: string }[] }
  | { kind: "auth_url";    url: string; instructions?: string }
  | { kind: "device_code"; userCode: string; verificationUri: string; expiresInSeconds?: number }
  | { kind: "progress";    message: string }
  | { kind: "prompt";      promptId: string; promptKind: "text" | "secret" | "select" | "manual_code";
                           message: string; placeholder?: string;
                           options?: { id: string; label: string; description?: string }[] }
  | { kind: "prompt_cancelled"; promptId: string }        // out-of-band resolution (e.g. callback won the race)
  | { kind: "done";        ok: boolean; error?: string }  // terminal, exactly once per flow
};
```

Event `kind`s deliberately mirror pi-ai's `AuthEvent`/`AuthPrompt` unions — the daemon translates,
it does not invent semantics.

**Registration style:** request/response pairs get real Zod schema entries in
`packages/protocol/src/messages.ts` (durable, multi-client RPC surface — flat-name convention) and
a slot in `sessionMessageSchema`. The flow-event push rides the `sessionMessageBaseSchema`
passthrough family with a local type guard at the point of use, exactly like
`checkout_status_update`. A `providerAuth` flag is added to `SERVER_FEATURES`
(`packages/protocol/src/client-capabilities.ts`, camelCase — freshest precedent is sprint-057's
`extensionPacks`; the set currently holds 7 keys) with its `SERVER_FEATURE_COMPAT` entry; the
daemon already folds every `SERVER_FEATURES` value into `server_info.features` (`ws-server.ts`
`defaultFeatures()`, `bootstrap.ts` relay path), so no emission code is needed — but
`client-capabilities.test.ts` asserts the **exact key set** (all 7, sorted) and will fail until
updated.

**Error convention (verified against `ws/router.ts`).** A handler returns a value, which the router
wraps and stamps with `requestId`; a throw becomes an `rpc_error` with the fixed code
`handler_error` (the only codes that exist are `unknown_message_type` and `handler_error`, emitted
by a module-private `sendRpcError` — **a handler cannot choose a code**). Therefore every *domain*
failure in this family is reported in the response payload as `{ ok: false, error: "<reason>" }`,
following `file_watch_subscribe_response`'s `{ ok: false, error: "too_many_watches" }` precedent.
`rpc_error`/`handler_error` is reserved for genuine unexpected exceptions.

### New/changed files

| File | Responsibility |
|------|----------------|
| `packages/protocol/src/messages.ts` (+ tests) | Request/response schemas + union entries |
| `packages/protocol/src/client-capabilities.ts` (+ test) | `providerAuth` server feature flag + COMPAT entry |
| `packages/server/src/agent/provider-auth/pi-auth-runtime.ts` | Lazy `ModelRuntime` seam: structural type mirrors, `listProviders`, bounded `checkAuth`, `login`, `logout` |
| `packages/server/src/agent/provider-auth/provider-auth-service.ts` | Flow registry + `AuthInteraction` bridge; also owns the `provider_auth_flow:<flowId>` `SessionSubscriptions` entry directly (`login`/`settleFlow`) — see the pseudocode's ownership note above |
| `packages/server/src/agent/provider-auth/provider-auth-rpc.ts` | `registerProviderAuthHandlers(registry, { providerAuthService, logger? })`, mirroring `registerFileWatchHandlers` / sprint-057's `registerExtensionsHandlers` (the service + `-rpc` module-pair precedent). Unlike its two siblings, takes **no** `subscriptions` dep — pure pass-through, no `SessionSubscriptions` calls of its own |
| `packages/server/src/agent/pi-home.ts` | ~~Export the path derivation~~ **Already done** (sprint-056/057): `resolvePiAgentDir(config)` is exported here and re-exported by `provider-registry.ts`. Remaining work: derive `authPath`/`modelsPath` (`<agentDir>/auth.json`, `<agentDir>/models.json`) beside it — e.g. `resolvePiAuthPaths(config)` — the single intentional coupling point |
| `packages/server/src/daemon/bootstrap.ts` | Construct the service, register handlers (**production bootstrap only**, like file-watch/checkout; `dev-bootstrap.ts` deliberately omits the family) |

## Behavior & Algorithms

```
class ProviderAuthService:
    runtime: lazy singleton
        authPath/modelsPath from resolvePiAgentDir(config)
        # precedence identical to the spawn path: agents.providers.pi.env.PI_CODING_AGENT_DIR
        #   > daemon.piHome > Pi default. Credentials written here MUST be the ones spawned agents read.
        ModelRuntime.create({ authPath, modelsPath, refreshOnCreate: false })  # dynamic import

    subscriptions: SessionSubscriptions          # owned directly by this service, not the RPC
        # layer (task-004 deviation from an earlier draft of this pseudocode — see that task's
        # summary). The RPC layer deciding whether to subscriptions.add() based on the *result* of
        # an awaited login() call races the fire-and-forget flow settling before that await
        # returns, which can add a disposer for a flow that already ended. Doing both inside
        # login()/settleFlow()'s own synchronous stretches removes the race by construction.

    flows: Map<flowId, { provider, session, abort: AbortController,
                         pendingPrompt?: { promptId, resolve, reject }, deadline }>

    login(session, provider, authType):
        validate provider exists and supports authType   -> { ok:false, error:"unknown_provider"|"unsupported_auth_type" }
        cancel any existing flow owned by this session   (one active flow per connection)
        flowId = uuid; register flow with TTL timer (10 min)
        subscriptions.add(session, "provider_auth_flow:"+flowId, () => cancel(session, flowId))
            # Synchronous, in the same tick as flow registration — before the fire-and-forget
            # login below is even started. SessionSubscriptions is ALREADY drained by ws-server's
            # session-close hook (disposeSession) — that's the whole disconnect-cancels-flow
            # mechanism, no new wiring.
        interaction = bridge(session, flowId)            # see below
        fire-and-forget:
            try:    await runtime.login(provider, authType, interaction)
                    emit { kind: "done", ok: true }
            catch:  emit { kind: "done", ok: false,
                           error: flow.abort.signal.aborted ? "cancelled" : sanitize(message) }
                    # Pi's own runtime.login() races interaction.signal and throws its OWN generic
                    # AbortError (verified in sprint-054/task-004) — never rely on our error type;
                    # the authoritative cancel test is our controller's `signal.aborted`.
            finally: unregister flow; subscriptions.remove(session, key)
        return { ok: true, flowId }

    bridge(session, flowId) implements AuthInteraction:
        notify(event) -> translate to flow_event kinds; session.send()
        prompt(p)     -> promptId = uuid; store pendingPrompt; send { kind: "prompt", ... }
                         return Promise settled by:
                           provider_auth_respond_request  -> resolve(value)
                           p.signal abort                 -> send prompt_cancelled; reject
                           flow abort / TTL / disconnect  -> reject
        signal = flow's AbortController.signal

    respond(session, flowId, promptId, value):
        flow must exist, be owned by session, and promptId must match pending
          -> else { ok:false, error:"not_found" }   (same opaque reason for all three, no leak)
        resolve pending prompt; clear it

    cancel / on session disconnect / on TTL expiry:
        abort controller; reject pending prompt; emit done(ok:false, error:"cancelled"|"timeout") if not yet terminal
```

- **Ownership:** flow events go **only** to the initiating session. `respond` naming a flowId/
  promptId owned by another session gets the same opaque `{ ok: false, error: "not_found" }` as an
  unknown flowId — existence is never leaked. `cancel` cannot express an error at all
  (`provider_auth_cancel_response`'s payload is `{ ok: boolean }`, no `error` field — see the RPC
  table's "Idempotent" note) and is unconditionally idempotent: a non-owned or already-gone flowId
  is a silent no-op, always `{ ok: true }` — which achieves the same non-leaking goal without a
  dedicated error code.
- **Disconnect = cancel**, for free, via `SessionSubscriptions`. No flow survives its socket; there
  is no resume (a login retry is cheap).
- **`list`** composes `getProviders()` (filtered to login-capable: `auth.oauth` or
  `auth.apiKey.login` present) with a **bounded** per-provider `checkAuth()`. Bounding is not
  hypothetical: sprint-054 hit real hangs and shipped a 3 s `checkAuthBounded` degrading to
  `"unknown"`. A single provider's failure degrades that row, never the whole list.
- **`logout`** delegates to `runtime.logout()`; running agents keep working until their current
  token/key use fails naturally — no proactive agent teardown in this scope. A provider may remain
  `configured` after logout when an ambient env var backs it (sprint-054 surfaced this) — re-check
  after removal and report it.
- **Lazy `import()` of `ModelRuntime` is not a startup optimization here.** Unlike the CLI, the
  daemon already statically imports `@earendil-works/pi-coding-agent`
  (`agent/providers/pi/session-hydration.ts` imports `SessionManager`), so the module graph is
  already paid for. It is lazy so that a daemon whose Pi runtime cannot be constructed still boots
  and serves every other RPC, failing only this family.
- Remote OAuth reality: any localhost callback server a Pi flow opens binds on the **daemon host**
  and will not receive the remote user's browser redirect; flows complete through the
  `auth_url` + `manual_code` race that Pi's prompt contract is explicitly designed for
  (`AuthPrompt.signal` cancels the manual prompt if a callback does win, surfaced as
  `prompt_cancelled`).

## Data & Persistence

- Credentials are written **only** by Pi's `ModelRuntime`/`AuthStorage` into the resolved
  `auth.json` (0600, file-locked — safe alongside concurrently running agents refreshing tokens).
- The daemon persists **nothing** new: flows are in-memory per-connection state, gone on restart.
- No changes to `$PI_STUDIO_HOME` layout.

## Error Handling & Edge Cases

| Condition | Expected behavior |
|-----------|-------------------|
| Pi runtime cannot be constructed | Every auth RPC answers `{ ok: false, error: "provider_auth_unavailable" }`; daemon otherwise unaffected. Construction is retried on the next call (a transient failure must not poison the service for the daemon's lifetime) |
| Unknown provider / unsupported authType | `{ ok: false, error: … }` before any flow is created |
| Second `login` from same session | Previous flow cancelled (emits `done ok:false "cancelled"`), new flow starts |
| `respond` with stale/unknown/not-owned flowId or promptId | `{ ok: false, error: "not_found" }`; flow state untouched |
| Session disconnects mid-flow | `SessionSubscriptions.disposeSession` fires the flow's cancel; prompt rejected; no credential written unless Pi already persisted it |
| Flow TTL (10 min) exceeded | Abort + `done ok:false "timeout"` |
| A provider's api-key flow asks a non-`secret` prompt | Supported — the bridge forwards every prompt kind verbatim; nothing assumes api_key means one secret (sprint-054 hit this) |
| Prompt value logging | **Never logged, never echoed in any response or event.** Log entries carry flowId/provider/promptKind only |
| Dev daemon (`dev-bootstrap.ts`) | Family not registered at all, so `unknown_message_type` — matching how file-watch/checkout already behave there. No special-casing inside the service |

## Dependencies on other scopes

- `../architecture/websocket-protocol.md` — envelope, flat-name RPC convention, capability flags,
  per-session push family.
- `../architecture/config.md` — `daemon.piHome` / provider env precedence reused via
  `resolvePiAgentDir`.
- `agent-providers.md` — provider isolation stays intact: the service lives under
  `packages/server/src/agent/` and touches Pi through its published `ModelRuntime` API, not through
  the provider adapter internals.

## Acceptance Criteria

- [x] `provider_auth_list_request` returns login-capable providers with correct
      configured/type/source against a temp `auth.json` fixture (configured, env-sourced, empty),
      and degrades a hung provider to `configured: "unknown"` without stalling the response.
- [x] An api_key login driven purely over WS (login → `prompt(secret)` event → respond → `done ok`)
      persists the credential into the daemon-resolved `auth.json` at mode 0600. Live-confirmed
      (sprint-055/task-005): real daemon, real `openai` provider, real `auth.json` at mode `0600`.
- [x] An OAuth-style flow (stubbed runtime) round-trips `auth_url`, `manual_code` prompt, and
      `done`; `prompt_cancelled` is emitted when the prompt's own signal aborts.
- [x] `cancel`, socket disconnect, and TTL each terminate the flow with `done ok:false` and reject
      the pending prompt; the flow registry is empty afterward (no leak). Cancel and disconnect
      live-confirmed against a real daemon (task-005); TTL confirmed via fake timers (task-003).
- [x] A cancel is reported as `"cancelled"` even though Pi's `login()` throws its own `AbortError`
      (the service tests `signal.aborted`, not the error type).
- [x] Cross-session `respond`/`cancel` returns `not_found`; flow events are never delivered to a
      non-owner session.
- [x] Secrets appear in no log line and in no outbound message (asserted via log capture and a
      full outbound-frame scan in tests). Live-confirmed too: a real fake credential scanned across
      every captured WS frame and the full daemon log — zero matches (task-005).
- [x] `server_info.features.providerAuth` is advertised on both the direct and relay handshake
      paths, and `client-capabilities.test.ts`'s exact-key-set assertion is updated. Direct path
      live-confirmed (task-005); relay path shares the identical `SERVER_FEATURES`-driven
      computation in `bootstrap.ts` (not separately live-exercised for this specific flag).
- [x] The resolved `authPath` is byte-identical to what `buildPiClient` gives a spawned agent for
      the same config (asserted directly, incl. the `agents.providers.pi.env` override case).
      Live-confirmed beyond the unit assertion: a real spawned `pi` agent read back the exact fake
      credential written over the wire (task-005's path-parity proof, the strong form).
- [x] All service/flow unit tests run against an injected fake runtime — no network, no real Pi.

## TODO(verify)

- [x] `rpc_error` code conventions — **answered**: only `unknown_message_type` and `handler_error`
      exist and a handler cannot choose one, so domain errors use `{ ok, error }` payloads
      (`ws/router.ts`; `file_watch_subscribe_response` precedent).
- [x] Whether `checkAuth()` can block — **answered**: yes, sprint-054 shipped a bounded wrapper
      degrading to `"unknown"` after 3 s.
- [x] Capability flag mechanics — **answered**: `SERVER_FEATURES` in
      `packages/protocol/src/client-capabilities.ts`, folded into `server_info.features` by
      `ws-server.ts` `defaultFeatures()` and `bootstrap.ts`'s relay path; no per-feature emission
      code, but the exact-key-set test must be updated.
- [x] Re-verified against the codebase (2026-08-20, post sprints 056–058): `resolvePiAgentDir` is
      **already exported** from `agent/pi-home.ts` (re-exported by `provider-registry.ts`) — only
      the `authPath`/`modelsPath` derivation remains; `SessionSubscriptions`
      (`add`/`remove`/`keysOf`/`disposeSession`) is still drained via `bootstrap.ts`'s
      `onSessionClose: (session) => subscriptions.disposeSession(session)`; router codes unchanged;
      `registerExtensionsHandlers` (sprint-057, `extensions/extensions-{service,rpc}.ts`, wired in
      `bootstrap.ts` only) is the freshest module-pair precedent; server and cli both pin
      `@earendil-works/pi-coding-agent@0.84.1`, one copy, no `auth.json` shape skew.
- [ ] Whether any bundled OAuth flow binds a fixed localhost callback port that could collide with
      the daemon's own listener (inherited unresolved from sprint-054/task-004 — needs a real
      provider account to close). **Still open after sprint-055/task-005's live run**: that run's
      ten-step sequence (swe/sprints/sprint-055-provider-auth-rpc/done/task-005-*-summary.md)
      exercised the api_key path end-to-end against a real daemon + real Pi `ModelRuntime` — login,
      respond, list, path-parity (a spawned agent read back the exact credential written over the
      wire), logout, cancel, and disconnect all confirmed live — but deliberately did **not**
      attempt a real OAuth login (task-005's own scope excludes it: "needs live provider
      credentials"). This question remains unanswered; still needs a real OAuth-capable provider
      account to close.
