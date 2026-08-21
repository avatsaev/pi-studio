# Task 003 — Web-client extension-UI state: controller lifecycle, store, capability gate

- **Sprint:** sprint-068-extension-ui-dialogs
- **Status:** backlog
- **Type:** feature
- **Area:** web-client / features/agent-ui
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** none

## Goal
Own one `AgentUiController` per connected client, expose its state to React through a small store
with per-agent selectors, and make the whole subsystem inert when the daemon lacks the `extensionUi`
capability.

## Context / why
Sprint-067 shipped the entire state layer in `packages/client` and it has no consumer: nothing
instantiates `createAgentUiController`, so a real dialog is still broadcast to nobody. This task is
the seam every rendering task depends on, and it is deliberately separate from the components so the
lifecycle rules (one controller per client, disposal on disconnect, capability re-check per
reconnect) are settled before any pixels exist.

The controller already handles rehydration ordering, reconnect resync, first-answer-wins, and
archive/delete pruning internally. The web-client must not reimplement or second-guess any of it —
its job is lifetime management and React distribution only.

## Scope references
- `swe/UI design/redesign 0.1.0/Extension Dialogs Visual Spec.html` § 05 (a card is grey and
  non-answerable while disconnected — driven by `answerable`, not by local connection state), § 08
  intro (nothing renders at all without the capability)
- `swe/features/extension-ui-client-sdk.md` § Controller, § Capability gating
- `packages/client/src/agent-ui-controller.ts` — `createAgentUiController(client, { onUnknownMethod })`
  returning `{ getState, subscribe, respond, resync, dispose }`
- `packages/client/src/agent-ui-state.ts` — `AgentUiState`, `AgentUiEffect`, selectors
  `pendingForAgent`, `resolvedForAgent`, `surfacesForAgent`, `remainingMs`, `RESOLVED_HISTORY_LIMIT`
- `packages/client/src/pistudio-client.ts` — `extensionUiAvailable()`, `respondToUi`,
  `AgentUiRespondResult`
- `packages/web-client/src/lib/connection/connection-store.ts` (`useConnectionStore`, `useClient`)

## What to build
- Create `packages/web-client/src/features/agent-ui/agent-ui-store.ts`:
  - Creates a controller when a client connects **and** `client.extensionUiAvailable()` is true;
    disposes it when the client changes or disconnects. Exactly one controller per client — this is
    app-scoped state, not per-pane (unlike `use-file-watch.ts`/`use-checkout-status.ts`, which are
    per-path subscriptions).
  - Mirrors `getState()` into the store on every `subscribe` callback.
  - `onUnknownMethod` routed to the app's existing dev logging, once per method (the controller
    already dedupes; do not add a second dedupe).
  - Hooks: `useAgentUiPending(agentId)`, `useAgentUiResolved(agentId)`, and a `respondToUi`-shaped
    action returning the SDK's `AgentUiRespondResult` **unchanged** — `{ ok: false, reason }` is a
    normal outcome a caller must handle, not an error to throw.
  - Selector results must be referentially stable across unrelated state changes (a dialog in
    session A must not re-render session B's timeline).
- Capability-absent behavior: no controller, no subscriptions, **zero** `agent_ui_*` RPCs on the
  wire, and every consumer hook returns empty. Capability is re-read per connection, never cached
  across reconnects (the controller re-checks internally; the store must not defeat that by holding
  a stale instance).

## Out of scope
- Rendering anything (tasks 005–008).
- Handling `AgentUiEffect`s. The controller emits `notify` and `replace_composer_text` effects on
  every transition; this sprint **ignores them deliberately** — sprint-069 wires them to toasts and
  the composer. Ignoring is the status quo (nothing renders them today), but it must be an explicit,
  commented decision so it is not mistaken for an oversight.
- Retained surfaces (`surfacesForAgent`) — sprint-070 renders them. Do not expose a surfaces hook
  yet; an unused public selector invites a second, divergent consumer.

## Acceptance criteria
- [ ] With a capability-carrying daemon, connecting creates exactly one controller; disconnecting
      disposes it; reconnecting creates a fresh one and the pending list rebuilds from the snapshot.
- [ ] With a capability-less `server_info`, no controller exists and **no** `agent_ui_*` frame is
      ever sent (assert on frames, not on a hidden element).
- [ ] `useAgentUiPending` for an agent with no dialogs returns a stable empty value that does not
      change identity between unrelated store updates.
- [ ] A dialog arriving for agent A does not change the value returned for agent B.
- [ ] `respondToUi`'s `{ ok: false, reason: "not_found" }` reaches the caller intact.
- [ ] Switching connections (disconnect → connect to a different daemon) leaves no state from the
      previous client.

## Test / verification plan
- Tests: `packages/web-client/src/features/agent-ui/agent-ui-store.test.ts` under Node — drive the
  store against a stub `PiStudioClient` (the SDK's own tests establish the shape to stub) covering
  create/dispose/reconnect, the capability-off path, per-agent isolation, and selector stability.
- Build/typecheck/lint: `npm run build:web-client`, `npm run typecheck`, `npm run lint`,
  `npx oxfmt <changed files>`.

## Hand-off for visual sign-off (user)
Nothing visible yet by design. The one checkable claim: against a **pre-sprint-066 daemon** (or any
build without the `extensionUi` feature flag), the app must behave exactly as it does today with no
console errors.

## Notes
`answerable` is the SDK's one-way door: `disconnected` sets it false and only a fresh snapshot resets
it. That is why disposal-and-recreate on reconnect is the correct lifecycle rather than keeping a
controller across a blip — the controller's own resync handles the in-connection case.
