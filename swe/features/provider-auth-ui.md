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

Grounded in the current facade (verified 2026-08-20): the methods live directly on
`PiStudioClient`, following the `listExtensionPacks`/`setExtensionPacks` precedent
(`packages/client/src/pistudio-client.ts`); internally they use only existing `DaemonClient` seams
— `request<T>(type, params, timeoutMs?)` for the RPC pairs, `onSessionMessage(handler)` with a
type-guard filter (as `TimelineHandle.subscribe` does for `agent_stream`) for
`provider_auth_flow_event`, and `hasFeature("providerAuth")` for the capability check. No
`DaemonClient` change is needed.

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
| **Settings dialog** (modal shell) | Opened from a gear icon button at the **top-right of the ConnectionBar** (rightmost control, next to the panel-toggle cluster, same `iconOnly`/ghost pattern). A large `Dialog`-primitive modal with a **category sidebar** (left) + content area (right). Ships with exactly one category — **Model Providers** — but the sidebar/content split is the point: future categories (Appearance is the obvious next — `theme/appearance-store.ts` already exists with no panel) add an entry, not a new surface. While only this capability-gated category exists, the gear itself is hidden when `hasProviderAuthCapability()` is false; once a capability-independent category ships, the gear becomes unconditional and only the Model Providers category hides |
| **Model Providers** (settings category) | Lists providers from `listProviderAuth()`: name, configured badge (`api key` / `oauth` / `env: VAR` / `not configured`), subscription tag, `Log in` / `Re-login` / `Log out` actions. Absent entirely when `hasProviderAuthCapability()` is false |
| **Login dialog** (modal overlay) | Step-driven by flow events; see state machine below. Esc/Cancel aborts the flow (existing overlay keyboard conventions) |
| **Onboarding nudge** | When connected and `listProviderAuth()` reports zero configured providers, the empty chat timeline shows a "Connect a model provider" call-to-action opening the panel |

**Where the panel lives (resolved 2026-08-20, refined same day):** the web-client has **no settings
screen and no router today** — `routes/WorkspacePage.tsx` is a single shell (ConnectionBar /
SessionList / TabPanelHost / RightSidebar / StatusBar), and the only settings-like state is
`theme/appearance-store.ts`, which itself has no panel. `app-navigation-screens.md`'s
`/settings/hosts/[serverId]/providers` route is spec-only. Rather than a one-off provider modal
that would need migrating later, this ships the **settings dialog shell itself**: a `Dialog`
primitive (`components/primitives/Dialog.tsx`, `OpenWorkspaceDialog` pattern) sized large, with a
thin category sidebar and a content pane, categories declared in a small local registry array.
Model Providers is the first and only category. This is barely more work than a bare modal — no
router, still one lazy chunk — and it *is* the settings IA rather than something that folds into
one later; `app-navigation-screens.md`'s settings route, when it lands, renders these same
category panels. Building any further category is explicitly out of scope here.

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
| `packages/client/src/pistudio-client.ts` (+ `pistudio-client.test.ts`) | The four SDK methods + local TS types/type guard for the flow-event push (per-session passthrough family — no protocol schema needed); tests follow the existing `makeScriptedDaemon()` injected-transport pattern |
| `packages/web-client/src/features/provider-auth/login-flow.ts` (+ test) | **Pure** reducer: `(dialogState, flowUiEvent) -> dialogState` — all step/ordering logic lives here, unit-testable under the node-env vitest setup (no jsdom; same pure-module/thin-component split as `timeline/reducer.ts` vs `Timeline.tsx`) |
| `packages/web-client/src/features/settings/SettingsDialog.tsx` (+ CSS module) | The settings shell: large `Dialog`-primitive modal, category sidebar + content pane, categories declared in a small local registry array (one entry today: Model Providers). Opened from a gear icon at the ConnectionBar's top-right; the gear is hidden while every registered category is capability-gated off |
| `packages/web-client/src/features/provider-auth/` (`ModelProvidersPanel`, `LoginDialog`, QR, `*.module.css`) | Thin components over the reducer: the Model Providers category panel rendered inside `SettingsDialog`, the `Dialog`-primitive login overlay, `EmptyState`-based nudge, design-token CSS modules (`--pi-color-*` / `--pi-spacing-*` / `--pi-font-size-*`, no raw literals); a small new QR component wrapping `qrcode`'s browser `toDataURL` (no QR component exists in web-client — the CLI's is terminal-side), loaded only inside the lazy dialog chunk |
| `packages/web-client/package.json` | `qrcode` devDependency (web-client ships no runtime deps; Vite bundles it into the code-split chunk) |

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
- The dialog and panel mount lazily via the established
  `lazy(() => import(…).then(m => ({ default: m.X })))` registry pattern (`panel-registry.ts` /
  `viewer-registry.ts`); no auth code — and no `qrcode` — on the hot path.

## Data & Persistence

- **None client-side.** No secrets, no flow state, nothing in localStorage. All durable state is
  the daemon host's `auth.json`, owned by Pi.

## Error Handling & Edge Cases

| Condition | Expected behavior |
|-----------|-------------------|
| Server lacks the `providerAuth` capability (old daemon) | Settings gear, panel, and nudge all absent (the only settings category is provider auth today); zero RPCs issued |
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
- [ ] The Model Providers category inside the Settings dialog (gear at the ConnectionBar's
      top-right) shows accurate badges against a daemon fixture in all four states (key, oauth,
      env-sourced, unconfigured).
- [ ] API-key login end-to-end in a real browser against a **production-bootstrap** daemon (the
      dev daemon deliberately omits this RPC family): open dialog → masked input → success badge,
      credential visible to `pi-studio auth status` on the daemon host.
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

- [x] Where the panel slots into the web-client navigation IA — **answered** (2026-08-20, refined
      same day per user direction): no settings screen or router exists in web-client at all; ship
      the **settings dialog shell itself** — gear icon at the ConnectionBar's top-right opening a
      large `Dialog`-primitive modal with a category sidebar (`OpenWorkspaceDialog` precedent for
      the primitive), Model Providers as the sole category. This *is* the settings IA;
      `app-navigation-screens.md`'s `/settings/hosts/[serverId]/providers` route renders the same
      category panels when that scope lands.
- [x] QR component reuse — **answered**: none exists in web-client (`qrcode` usage is daemon/CLI
      terminal-side only), so nothing to extract; a small new component wraps `qrcode`'s browser
      `toDataURL` inside the lazy dialog chunk.
- [x] Onboarding nudge placement — **answered**: the empty chat timeline
      (`features/chat/Timeline.tsx` renders "No messages yet — say something to start." when the
      row list is empty) is the slot; augment it with an `EmptyState`-primitive CTA when connected
      and zero providers are configured. No banner — no app-wide banner pattern exists to reuse.
