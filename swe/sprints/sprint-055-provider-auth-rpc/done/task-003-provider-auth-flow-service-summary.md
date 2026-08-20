# Task 003 — `ProviderAuthService`: flow registry + `AuthInteraction` bridge — Summary

- **Sprint:** sprint-055-provider-auth-rpc
- **Completed:** 2026-08-20
- **Status:** done

## What was implemented

`packages/server/src/agent/provider-auth/provider-auth-service.ts` — `ProviderAuthService`,
turning Pi's callback-style `AuthInteraction` into daemon-side flow state:

- Constructed with `{ runtime: PiAuthRuntime, logger?, ttlMs? = 600_000, setTimer?/clearTimer? }`
  (timer seams for fake-timer tests). A `now` option was scoped out — nothing in the design
  actually needed a clock read beyond the timer seam itself, so it would have been an unused
  parameter; noted as a deliberate deviation below.
- `listProviders()` — `runtime.listProviders()` composed with a bounded per-provider `checkAuth()`
  (bound already lives inside `PiAuthRuntime`, so one bound suffices); a construction failure
  degrades to `{ ok: false, providers: [] }` rather than throwing.
- `login(session, provider, authType)` — validates provider existence and `authType` support
  *before* creating a flow (`unknown_provider` / `unsupported_auth_type`; runtime-unavailable →
  `provider_auth_unavailable`); cancels any existing flow owned by the session (one flow per
  session, enforced via a `WeakMap<Session, flowId>`); creates the flow, arms the TTL timer, and
  returns `{ ok: true, flowId }` immediately — the login itself runs fire-and-forget.
- The `AuthInteractionLike` bridge: `notify(event)` maps 1:1 onto flow-event kinds via a small
  `type` → `kind` field rename and pushes `session.send()`, wrapped in try/catch so it can never
  throw into Pi; `prompt(p)` allocates a `promptId`, parks resolvers, and pushes a `prompt` event —
  settled by `respond()`, the prompt's own `signal` aborting (pushes `prompt_cancelled`, rejects
  only that prompt, flow stays alive), or the flow ending. A second concurrent prompt while one is
  pending is treated as a protocol violation and fails the whole flow, per the task's explicit
  instruction not to silently drop it.
- `respond`/`cancel`/`logout` — `respond` returns the same opaque `not_found` for an unknown
  flowId, a stale promptId, *and* a cross-session flowId (existence never leaked). `cancel` is
  unconditionally idempotent (see "Deviation" below). `logout` delegates to the runtime and
  forwards `stillConfigured`.
- **Exactly-one-`done` guarantee:** a `terminal` boolean per flow, compare-and-set inside a single
  `settleFlow()` used by both `abortFlow` (cancel/TTL) and the fire-and-forget's own
  success/failure handling — whichever reaches it first wins, the other is a no-op. This is what
  makes "cancel races the runtime settling" safe without inspecting Pi's error type: `abortFlow`
  emits `done ok:false "cancelled"` synchronously and marks the flow terminal *before* Pi's own
  `runtime.login()` rejection (with its own generic `AbortError`) has a chance to reach the
  fire-and-forget's catch block, which then finds the flow already terminal and no-ops.
- Secrets: prompt values never appear in a log call (only `{flowId, provider, promptId,
  promptKind}` are logged) and never get echoed into a response or event — verified by a dedicated
  test scanning every captured log line and every sent frame for the entered secret.

No `SessionSubscriptions`/RPC registration/bootstrap wiring here — out of scope, task-004's job.

## Deviation from the task spec (documented, not silent)

**`cancel()`'s error semantics.** The task file's pseudocode/prose said `respond`/`cancel` naming a
flow owned by another session should return `{ ok: false, error: "not_found" }`. But task-001's own
protocol schema for `provider_auth_cancel_response` — already implemented and locked — is
`payload: { ok: z.boolean() }`, with **no `error` field**, and the RPC table itself documents
`cancel` as "Idempotent — `ok:true` even if the flow was already gone." These two statements from
the same spec document contradict each other for `cancel` specifically (`respond`'s `not_found`
behavior has no such conflict and is implemented exactly as specified). Since the wire contract is
already shipped and cannot express a `cancel` error, `cancel()` is implemented as unconditionally
idempotent: it silently no-ops for an unknown or non-owned flowId (never mutating state it doesn't
own, never leaking existence) and always returns `{ ok: true }`. This still satisfies the
"existence is not leaked" goal the ownership bullet cares about — a caller genuinely cannot tell
the difference between "nothing there" and "not yours" from a `cancel` response either way.

## Files created / changed

| File | Change |
|------|--------|
| `packages/server/src/agent/provider-auth/provider-auth-service.ts` | created |
| `packages/server/src/agent/provider-auth/provider-auth-service.test.ts` | created |
| `swe/features/provider-auth-rpc.md` | modified — resolved the Ownership-bullet vs. cancel-response-schema contradiction (see Deviation above) |

## Build & test results

```
$ npm run build:server
tsc -b packages/server && chmod +x packages/server/dist/daemon/main.js
(success)

$ npm run clean && npm run typecheck
tsc -b
(success, 0 errors)

$ npx oxlint packages/server/src/agent/provider-auth/provider-auth-service.ts \
    packages/server/src/agent/provider-auth/provider-auth-service.test.ts
(exit 0, no findings)

$ npx oxfmt --check <same files>
All matched files use the correct format.

$ npx vitest run packages/server/src/agent/provider-auth
Test Files  2 passed (2)
     Tests  38 passed (38)

$ npx vitest run packages/server/src/agent   # full agent directory, confirming no regressions
Test Files  21 passed (21)
     Tests  248 passed (248)
```

`provider-auth-service.test.ts` (22 tests): api_key round trip (login → prompt(secret) event →
respond → done ok:true, fake runtime receives the entered value), OAuth-shaped round trip
(auth_url → manual_code prompt → respond → done ok), per-prompt `signal` abort (pushes
`prompt_cancelled`, rejects only that prompt, flow survives to a second prompt), `cancel()`
(aborts + rejects pending prompt + exactly one `done ok:false "cancelled"`; idempotent for
unknown/already-gone; silent no-op for a non-owned flow), TTL expiry (`done ok:false "timeout"`
under fake timers), the AbortError-after-cancel authoritativeness test (fake runtime throws its own
generic `Error("AbortError")`, service still reports `"cancelled"`), second-login-cancels-first,
`respond` edge cases (unknown flowId / stale promptId / cross-session, all `not_found`, state
untouched), login validation (`unknown_provider`, `unsupported_auth_type`,
`provider_auth_unavailable`), session isolation (events never reach a bystander session), no-leak
checks (post-TTL re-login succeeds; post-completion cancel is a harmless no-op), secret hygiene
(entered value absent from every log line and every sent frame), `listProviders()` composition,
and `logout()` delegation + error sanitization.

## Acceptance criteria

- [x] An api_key flow round-trips against a fake runtime: `login` → `prompt(secret)` event →
      `respond` → terminal `done { ok: true }`, and the fake runtime received the entered value.
- [x] An OAuth-shaped flow round-trips `auth_url` → `manual_code` prompt → `respond` → `done ok`.
- [x] A prompt's own `signal` aborting pushes `prompt_cancelled` for that `promptId` and rejects
      only that prompt — the flow stays alive.
- [x] `cancel()` and TTL expiry each abort the flow, reject the pending prompt, and emit exactly
      one `done { ok: false, error: "cancelled" | "timeout" }`.
- [x] When the fake runtime's `login()` rejects with a generic `AbortError` after a cancel, the
      terminal event still reports `"cancelled"` (proves `signal.aborted` — via the `terminal`
      compare-and-set — is authoritative, not Pi's error type).
- [x] A second `login` from the same session cancels the first (first flow emits `cancelled`) and
      starts a new one.
- [x] `respond` with an unknown flowId, a stale promptId, or from a **different** session returns
      `{ ok: false, error: "not_found" }` and leaves flow state untouched.
- [x] Flow events are sent only to the owning session's `send` (a second fake session receives
      nothing).
- [x] After every terminal path the flow map is empty and the TTL timer is cleared (no leak) —
      verified indirectly (a post-TTL re-login from the same session succeeds cleanly, and a
      post-completion cancel is a harmless no-op) since the maps are private implementation state.
- [x] No prompt value appears in any log line or any sent frame (assert over captured logs and all
      frames).
- [x] Exactly one `done` per flow, even when cancel races the runtime settling.

## Follow-ups / TODO(verify)

- None outstanding for this task's own scope. RPC registration, `SessionSubscriptions` wiring, and
  bootstrap construction are task-004's; protocol schemas are task-001's (done).
- The `cancel()` spec deviation above was reflected back into
  `swe/features/provider-auth-rpc.md`'s Behavior & Algorithms Ownership bullet in this same task,
  so the two sections no longer contradict each other.
