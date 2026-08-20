# Task 003 — `ProviderAuthService`: flow registry + `AuthInteraction` bridge

- **Sprint:** sprint-055-provider-auth-rpc
- **Status:** done
- **Type:** feature
- **Area:** packages/server (agent/provider-auth)
- **Priority:** P1
- **Estimated size:** M
- **Depends on:** task-002

## Goal

Turn Pi's callback-style `AuthInteraction` into daemon-side state: one flow per session, `notify` →
per-session push, `prompt` → a pending promise resolved by a later RPC, with abort/TTL/ownership
rules and no leaks.

## Context / why

Pi drives login by *calling back*: `notify(event)` (synchronous) and `prompt(p): Promise<string>`.
The daemon has to invert that into messages: emit an event, park the promise, resolve it when the
client answers. That inversion — plus its cancellation and ownership rules — is the whole service.

Facts from sprint-054's real-flow verification that shape this:

- `runtime.login()` **itself** races `interaction.signal` and rejects with its **own** generic
  `AbortError`. Never infer cancellation from the error type; test `controller.signal.aborted`.
- A prompt carries its **own** optional `signal` (separate from the flow-wide one), aborted when an
  out-of-band event resolves the step — e.g. an OAuth callback beating a `manual_code` prompt. That
  surfaces to the client as `prompt_cancelled`, not as a flow failure.
- An api_key flow may ask a **non-secret** prompt. Forward every kind verbatim; assume nothing.

## Scope references

- `swe/features/provider-auth-rpc.md` § Behavior & Algorithms (full pseudocode), § Flow-event push,
  § Error Handling & Edge Cases
- `packages/server/src/ws/session.ts` — `Session.send(envelope)` (line 36)
- `packages/server/src/files/file-watch-service.ts` — service shape to mirror (`subscribe` returning
  an unsub)
- Create: `packages/server/src/agent/provider-auth/provider-auth-service.ts` (+ `.test.ts`)
- Depends on task-002's `PiAuthRuntime` seam.

## What to build

`ProviderAuthService`, constructed with `{ runtime: PiAuthRuntime, logger?, ttlMs? = 600_000,
now?, setTimer?/clearTimer? }` (timer seams so tests use fake timers):

```ts
listProviders(): Promise<ProviderAuthInfo[]>          // runtime.listProviders + bounded checkAuth per row
login(session, provider, authType): Promise<{ ok: boolean; flowId?: string; error?: string }>
respond(session, flowId, promptId, value): { ok: boolean; error?: string }
cancel(session, flowId): { ok: true }                 // idempotent
logout(provider): Promise<{ ok: boolean; stillConfigured?: boolean; error?: string }>
```

Flow record: `{ flowId, provider, session, abort: AbortController, pendingPrompt?: { promptId,
resolve, reject }, timer }`, held in a `Map<flowId, Flow>` plus a `WeakMap<Session, flowId>` for the
one-flow-per-session rule.

`login()`:
1. Validate provider exists / supports `authType` → `{ ok: false, error: "unknown_provider" |
   "unsupported_auth_type" }` **before** creating a flow. Runtime unavailable →
   `{ ok:false, error: "provider_auth_unavailable" }`.
2. Cancel any existing flow for this session (emits its terminal `done ok:false "cancelled"`).
3. Create the flow, arm the TTL timer, return `{ ok: true, flowId }` **immediately** — the login
   runs fire-and-forget; progress is pushed.
4. On settle: emit exactly one terminal `done` — `{ ok: true }`, or `{ ok: false, error:
   signal.aborted ? "cancelled" : sanitize(message) }`. Always unregister the flow and clear the
   timer, exactly once, whichever path ends it.

The bridge (`AuthInteractionLike`):
- `notify(event)` → map `info`/`auth_url`/`device_code`/`progress` 1:1 onto flow-event kinds and
  `session.send({ type: "session", message: { type: "provider_auth_flow_event", flowId, event } })`.
  Must be **synchronous** and must never throw into Pi.
- `prompt(p)` → allocate `promptId`, store the pending resolvers, push a `prompt` event carrying
  `promptKind`, `message`, `placeholder?`, `options?`. The returned promise settles on: `respond`
  (resolve), the prompt's own `signal` (push `prompt_cancelled`, reject), or flow abort/TTL
  (reject). Replace-or-reject if a second prompt arrives while one is pending (Pi is sequential;
  treat concurrent prompts as a protocol violation and fail the flow rather than silently dropping).
- `signal` = the flow's `AbortController.signal`.

Cancellation entry points — `cancel()`, the disconnect disposer registered by task-004, and TTL
expiry — all funnel into one internal `abortFlow(flow, reason)`.

**Secrets:** never log a prompt value; log `{ flowId, provider, promptKind }` only. Never echo a
value in any response or event.

## Out of scope

- RPC registration, `SessionSubscriptions` wiring, bootstrap construction (task-004).
- Protocol schemas (task-001).
- Anything client-side.

## Acceptance criteria

- [ ] An api_key flow round-trips against a fake runtime: `login` → `prompt(secret)` event →
      `respond` → terminal `done { ok: true }`, and the fake runtime received the entered value.
- [ ] An OAuth-shaped flow round-trips `auth_url` → `manual_code` prompt → `respond` → `done ok`.
- [ ] A prompt's own `signal` aborting pushes `prompt_cancelled` for that `promptId` and rejects
      only that prompt — the flow stays alive.
- [ ] `cancel()` and TTL expiry each abort the flow, reject the pending prompt, and emit exactly one
      `done { ok: false, error: "cancelled" | "timeout" }`.
- [ ] When the fake runtime's `login()` rejects with a generic `AbortError` after a cancel, the
      terminal event still reports `"cancelled"` (proves `signal.aborted` is authoritative).
- [ ] A second `login` from the same session cancels the first (first flow emits `cancelled`) and
      starts a new one.
- [ ] `respond` with an unknown flowId, a stale promptId, or from a **different** session returns
      `{ ok: false, error: "not_found" }` and leaves flow state untouched.
- [ ] Flow events are sent only to the owning session's `send` (a second fake session receives
      nothing).
- [ ] After every terminal path the flow map is empty and the TTL timer is cleared (no leak).
- [ ] No prompt value appears in any log line or any sent frame (assert over captured logs and all
      frames).
- [ ] Exactly one `done` per flow, even when cancel races the runtime settling.

## Test / verification plan

- Build: `npm run build:server` succeeds.
- Typecheck: `npm run typecheck` succeeds.
- Lint/format: `npx oxlint <changed files>`, `npx oxfmt --check <changed files>` clean.
- Tests: `packages/server/src/agent/provider-auth/provider-auth-service.test.ts` with a fake
  `PiAuthRuntime` (scriptable `login` that calls `notify`/`prompt`) and fake `Session` objects
  recording `send` calls — no WebSocket, no Pi, no network. Use `vi.useFakeTimers()` +
  `advanceTimersByTimeAsync` for TTL. Run `npx vitest run packages/server/src/agent/provider-auth`;
  all pass.

## Notes

- The one-flow-per-session rule keeps the registry trivially bounded; do not add a global cap.
- Sanitize the error message on the terminal event (provider messages are safe to relay, but never
  interpolate a prompt value into one).
- Keep `Session` typed as the real `Session` class but only ever call `send()` — that is what lets
  the tests use a minimal fake.
