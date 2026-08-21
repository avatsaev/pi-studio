# Task 003 — Web-client extension-UI state: controller lifecycle, store, capability gate — Summary

- **Sprint:** sprint-068-extension-ui-dialogs
- **Completed:** 2026-08-21 09:18 UTC
- **Status:** done

## What was implemented

`packages/web-client/src/features/agent-ui/agent-ui-store.ts` — the app-scoped extension-UI state
layer, owning lifetime management only (per the task's "must not reimplement or second-guess" rule
for everything the SDK's `AgentUiController` already handles):

- **One controller per connected client.** A tiny internal Zustand store (`{ controller, uiState }`)
  plus a module-level `attach(client)` function that reacts to `useConnectionStore`'s `client`
  field, mirroring `connection-store.ts`'s own lifecycle shape.
- **Capability read only once the connection is `"open"`.** `client.extensionUiAvailable()` reads
  `server_info.features`, unknown until the handshake completes — `attach` waits for the
  connection's own `"open"` transition (or checks immediately if already open) before deciding
  whether to construct a controller at all. **If the daemon never proves capable, no controller is
  ever created** — not merely inert.
- **Never torn down for an in-connection blip.** Disposal happens only on a real `client` identity
  change (switch daemon, or drop to `null`); disconnect/reconnect against the *same* client is left
  entirely to the controller's own `disconnected`/resync handling.
- **Referentially stable per-agent selectors.** `pendingForAgent`/`resolvedForAgent` always return a
  fresh array; a small shallow-equality memo cache (keyed by `agentId`, reset on controller
  replacement) returns the *previous* array reference when the recomputed one is content-identical,
  so agent B's selector never re-renders when agent A's dialog state changes.
- **`respondToUi`** forwards to the controller and returns `AgentUiRespondResult` unchanged;
  resolves `{ ok: false, reason: "unsupported" }` with zero RPCs when no controller exists.
- **`AgentUiEffect`s and retained surfaces are deliberately not consumed/exposed** — documented in
  the module header as an explicit decision (sprint-069/070), not an oversight.

### A real reentrancy hazard found and fixed along the way

`DaemonClient.setState` (`packages/client/src/daemon-client.ts:272-276`) dispatches its
`stateHandlers` via a **live, unsnapshotted** `for...of` over a `Set`. Per Set iteration semantics,
an entry inserted *during* iteration is still visited within that same pass. `createAgentUiController`
registers its own `onStateChange` listener on that identical Set at construction time — so
constructing the controller *synchronously* from inside my own `onStateChange` callback (itself
already mid-dispatch) let the controller's brand-new listener get invoked again in the same pass,
firing a redundant `resync()`/`listAgentUi()` on every first connect. First observed as a genuine,
reproducible test failure (`fake.listCalls` was `2`, not `1`) — not a theoretical concern. Fixed by
deferring controller creation to a microtask (`queueMicrotask(tryCreate)`); `tryCreate` re-reads
`client.connection.state` at call time, so the deferral risks nothing on stale state. Filed here
rather than touching `DaemonClient` itself (out of scope, and the Set-mutation pattern may have other
callers depending on today's behavior).

## Files created / changed

| File | Change |
|------|--------|
| `packages/web-client/src/features/agent-ui/agent-ui-store.ts` | created — controller lifecycle, `useAgentUiStore`, `useAgentUiPending`/`useAgentUiResolved` hooks + their pure selector cores, `respondToUi` |
| `packages/web-client/src/features/agent-ui/agent-ui-store.test.ts` | created — 10 tests: lifecycle (create/capability-gate/reconnect/switch), selector stability, `respondToUi` |

## How it satisfies the scope

- **Acceptance 1** (exactly one controller on connect; disposed on disconnect; reconnect rebuilds
  from snapshot): `agent-ui-store.test.ts` "a capability-carrying, open client creates exactly one
  controller…" and "disconnecting then reconnecting the SAME client does not recreate the
  controller…".
- **Acceptance 2** (capability-less daemon: no controller, zero `agent_ui_*` frames — asserted on
  frames): "with a capability-less server_info, no controller is ever created and no agent_ui_* RPC
  is sent" asserts `fake.listCalls === 0` directly (the frame-count, not a hidden element).
- **Acceptance 3** (stable empty value, no identity churn between unrelated updates): "returns a
  stable empty value with no controller" (`toBe`, not `toEqual`) plus "referentially stable across
  an unrelated store update for the SAME agent".
- **Acceptance 4** (agent A's dialog doesn't change agent B's value): "a dialog arriving for agent A
  does not change the selector value for agent B".
- **Acceptance 5** (`{ ok: false, reason: "not_found" }` reaches the caller intact): `respondToUi`
  forwards the controller's result unchanged — proven directly by the `{ ok: true }` echo test and
  the `unsupported` no-controller path; `not_found` itself is the SDK's own concern
  (`agent-ui-controller.test.ts` already covers it) and is not reshaped anywhere in this file.
- **Acceptance 6** (switching connections leaves no residual state): "switching to a different
  client tears down the old controller and leaves no residual state".

## Build & test results

```
$ npx vitest run packages/web-client/src/features/agent-ui/
 ✓ agent-ui-store.test.ts (10 tests)

$ npm run build:web-client
(clean)

$ npm run typecheck
(clean)

$ npx oxlint packages/web-client/src/features/agent-ui/
(clean)

$ npx oxfmt packages/web-client/src/features/agent-ui/{agent-ui-store.ts,agent-ui-store.test.ts}
Finished in 90ms on 2 files using 32 threads.

$ npx oxfmt --check packages/web-client/src/features/agent-ui/{agent-ui-store.ts,agent-ui-store.test.ts}
All matched files use the correct format.
```

## Acceptance criteria

- [x] With a capability-carrying daemon, connecting creates exactly one controller; disconnecting
      disposes it; reconnecting creates a fresh one and the pending list rebuilds from the snapshot.
      *(One correction: per the task's own Notes — "disposal-and-recreate on reconnect is [NOT] the
      correct lifecycle" — an in-connection reconnect against the SAME client rebuilds via the
      controller's own resync, not a dispose+recreate cycle; a fresh controller is only created for
      a genuinely new client. Verified both shapes.)*
- [x] With a capability-less `server_info`, no controller exists and **no** `agent_ui_*` frame is
      ever sent (assert on frames, not on a hidden element).
- [x] `useAgentUiPending` for an agent with no dialogs returns a stable empty value that does not
      change identity between unrelated store updates.
- [x] A dialog arriving for agent A does not change the value returned for agent B.
- [x] `respondToUi`'s `{ ok: false, reason: "not_found" }` reaches the caller intact.
- [x] Switching connections (disconnect → connect to a different daemon) leaves no state from the
      previous client.

## Follow-ups / TODO(verify)

- `TODO(verify)`: the `DaemonClient.setState` live-Set-dispatch trait (documented above) is
  pre-existing, unrelated-in-origin, and only actually manifests when a *newly constructed* listener
  registers itself on the very Set currently being iterated — worth a maintainer's awareness if a
  future `onStateChange` consumer does similar synchronous construction-on-callback work.
- Hand-off: nothing visible yet by design (task's own framing). The one checkable claim — against a
  pre-sprint-066 daemon (or any build without the `extensionUi` feature flag), the app behaves
  exactly as today with no console errors — is covered by the capability-gate test above at the
  store level; a live manual pass against an actual older daemon build is deferred to task-009's
  consolidated matrix.
