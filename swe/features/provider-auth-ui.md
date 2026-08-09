# Provider Auth — Client SDK & Web UI

> Part of: [MAIN-SCOPE.md](../MAIN-SCOPE.md)
> Dependencies: [provider-auth-rpc.md](provider-auth-rpc.md) (this scope consumes that contract verbatim)
> Related scopes: [app-navigation-screens.md](app-navigation-screens.md),
> [ui-components.md](ui-components.md), [composer-ui.md](composer-ui.md),
> [../architecture/client-app-runtime.md](../architecture/client-app-runtime.md)

## Purpose

Give web-client users (local or relay-remote) a first-class way to see model-provider auth state
and log in to a provider — API key or subscription OAuth — entirely from the browser, with the
daemon doing the real work ([provider-auth-rpc.md](provider-auth-rpc.md)). Two deliverables,
loosely coupled to each other:

1. **SDK** (`packages/client`): typed `PiStudioClient` methods that hide flowId/promptId plumbing
   behind a callback interface intentionally shaped like Pi's `AuthInteraction`.
2. **Web UI** (`packages/web-client`): a Model Providers settings panel + login dialog, plus an
   onboarding nudge when no provider is configured.

Non-goals: desktop/mobile shells, CLI `--host` remote login (both are follow-ups that reuse the
same SDK surface), any credential display or editing.

## Public Contract

### SDK (`PiStudioClient`)

```ts
interface ProviderAuthCallbacks {
  onEvent(e: ProviderAuthFlowUiEvent): void;          // info | auth_url | device_code | progress | prompt_cancelled
  prompt(p: ProviderAuthPromptUi): Promise<string>;   // resolves with the user's value; rejects on cancel
}

client.listProviderAuth(): Promise<ProviderAuthInfo[]>;
client.loginProvider(
  provider: string,
  authType: "api_key" | "oauth",
  callbacks: ProviderAuthCallbacks,
  opts?: { signal?: AbortSignal },
): Promise<{ ok: boolean; error?: string }>;          // settles on the flow's `done` event
client.logoutProvider(provider: string): Promise<void>;
client.hasProviderAuthCapability(): boolean;          // from server_info capability flag
```

SDK responsibilities (all invisible to callers):

- Correlates `provider_auth_login_response.flowId` with subsequent `provider_auth_flow_event`
  pushes; filters events to the active flow.
- Turns `kind: "prompt"` events into `callbacks.prompt()` calls and sends
  `provider_auth_respond_request` with the resolved value; a `prompt_cancelled` event rejects the
  pending prompt promise (UI dismisses the input).
- `opts.signal` abort → `provider_auth_cancel_request`; the returned promise settles with the
  terminal `done` event (or a synthesized `ok:false` on disconnect).
- One active flow per client instance; starting a second rejects locally (mirrors the server rule).
- **Raw WebSocket use outside the SDK is prohibited** (existing project rule) — the web UI must go
  through these methods only.

### Web UI surface

| Surface | Behavior |
|---------|----------|
| Settings → **Model Providers** panel | Lists providers from `listProviderAuth()`: name, configured badge (`api key` / `oauth` / `env: VAR` / `not configured`), subscription tag, `Log in` / `Re-login` / `Log out` actions. Hidden entirely when `hasProviderAuthCapability()` is false |
| **Login dialog** (modal overlay) | Step-driven by flow events; see state machine below. Esc/Cancel aborts the flow (existing overlay keyboard conventions) |
| **Onboarding nudge** | When connected and `listProviderAuth()` reports zero configured providers, the composer/empty-session area shows a "Connect a model provider" call-to-action opening the panel |

Login dialog step rendering:

| Flow input | Rendering |
|------------|-----------|
| `prompt secret` | Masked text input + submit; value never persisted client-side |
| `prompt text` / `manual_code` | Plain text input with placeholder |
| `prompt select` | Option list (label + description), click to answer |
| `auth_url` | Prominent "Open in browser" link (new tab) + copy button + QR code (relay users often pair phone↔daemon already) |
| `device_code` | Large `userCode`, verification link, expiry countdown when provided |
| `info` / `progress` | Status line region; progress replaces, info appends |
| `done ok` | Success state; refresh provider list; auto-close after short delay |
| `done !ok` | Error state with message + "Try again" |

### New/changed files

| File | Responsibility |
|------|----------------|
| `packages/client/src/…` (SDK facade + types) | Methods above; local TS types for the flow-event push (per-session passthrough family — type guard, no protocol schema needed) |
| `packages/web-client/src/…/provider-auth/` | Panel, dialog components (thin), CSS modules with design tokens |
| `packages/web-client/src/…/provider-auth/login-flow.ts` | **Pure** reducer: `(dialogState, flowUiEvent) -> dialogState` — all step/ordering logic lives here, unit-testable under the node-env vitest setup (no jsdom, per project convention) |

## Behavior & Algorithms

```
# login-flow.ts reducer (pure, exhaustive over event kinds)
state = { phase: "starting" | "waiting" | "prompt" | "done",
          statusLines: [], authUrl?, deviceCode?, prompt?, result? }

on auth_url        -> record url (phase stays; prompt may arrive alongside — keep both visible)
on device_code     -> record code
on info/progress   -> append/replace status line
on prompt          -> phase = "prompt", store prompt descriptor
on prompt_cancelled-> if matching promptId: clear prompt, phase = "waiting"
on done            -> phase = "done", store result

# Dialog component (thin): renders state, wires inputs to the pending prompt's resolver,
# Cancel -> abort signal -> SDK cancels -> reducer sees done(ok:false).
```

- Provider list is fetched on panel open and re-fetched after every `done ok` and `logout` — no
  client-side cache or store; auth state is rare-change, low-volume data.
- Reconnect mid-flow: the SDK's flow promise settles `ok:false` ("connection lost"); the dialog
  shows the error state. No resume (matches server: flows die with the socket).
- The dialog mounts lazily (code-split with the settings surface); no auth code on the hot path.

## Data & Persistence

- **None client-side.** No secrets, no flow state, nothing in localStorage. All durable state is
  the daemon host's `auth.json`, owned by Pi.

## Error Handling & Edge Cases

| Condition | Expected behavior |
|-----------|-------------------|
| Server lacks `provider_auth` capability (old daemon) | Panel and nudge absent; zero RPCs issued |
| `rpc_error` on login start (unknown provider, pi unavailable) | Inline error in the panel row; dialog never opens |
| Flow event for an unknown/stale flowId | SDK drops it silently |
| User closes dialog mid-prompt | Abort → cancel RPC → pending prompt promise rejects; no dangling handlers |
| Second login attempt while a flow is active | SDK rejects locally with a clear message; UI disables other rows' buttons while a dialog is open |
| Disconnect during flow | Flow promise settles `ok:false`; provider list refetched on reconnect |
| `logout` of the provider a running agent uses | Allowed; server scope defines semantics (agents fail naturally). UI shows a passive caution line in the confirm step |

## Dependencies on other scopes

- `provider-auth-rpc.md` — the wire contract; this scope adds **no** protocol messages.
- `ui-components.md` — overlays, inputs, buttons; reuse existing primitives, no new design system
  surface.
- `../architecture/client-app-runtime.md` — session context/capability access, reconnect behavior.

## Acceptance Criteria

- [ ] `PiStudioClient` exposes `listProviderAuth` / `loginProvider` / `logoutProvider` /
      `hasProviderAuthCapability`, fully typed, tested against a mocked transport (prompt
      round-trip, cancel, disconnect, stale-event drop).
- [ ] Settings shows the Model Providers panel with accurate badges against a daemon fixture in
      all four states (key, oauth, env-sourced, unconfigured).
- [ ] API-key login end-to-end in a real browser against a dev daemon: open dialog → masked input →
      success badge, credential visible to `pi-studio auth status` on the daemon host.
- [ ] OAuth-shaped flow renders auth_url + QR and a manual_code input concurrently, and completes
      through the manual path (stub provider acceptable).
- [ ] Cancel (button and Esc) aborts server-side (verified by daemon flow-registry test hook/logs).
- [ ] Onboarding nudge appears when zero providers configured and disappears after a successful
      login without a page reload.
- [ ] `login-flow.ts` reducer has node-env unit tests covering every event kind, out-of-order
      arrival (`auth_url` after `prompt`), and `prompt_cancelled` racing a user answer.
- [ ] Old-daemon compatibility: against a capability-less server_info fixture, no provider-auth
      RPC is ever sent.

## TODO(verify)

- [ ] Where the settings panel slots into the current web-client navigation IA
      (app-navigation-screens.md) — dedicated route vs. section in the existing settings screen.
- [ ] Whether an existing QR component is shared between pairing UI and this dialog or needs a
      small extraction.
- [ ] Exact UX for the onboarding nudge placement (composer empty state vs. banner) — designer pass.
