# Extension UI Bridge — Client SDK Surface (no rendering)

> Part of: [MAIN-SCOPE.md](../MAIN-SCOPE.md)
> Related scopes: [extension-ui-rpc.md](extension-ui-rpc.md) (the server side this consumes),
> [provider-auth-rpc.md](provider-auth-rpc.md) (nearest precedent — payload-borne domain errors),
> [agent-sessions.md](agent-sessions.md), [client-app-runtime.md](../architecture/client-app-runtime.md),
> [../architecture/websocket-protocol.md](../architecture/websocket-protocol.md)

## Purpose

Sprint-066 shipped the daemon side of Pi's extension-UI bridge: `agent_ui_request` /
`agent_ui_resolved` broadcasts, `agent_ui_respond` / `agent_ui_list` RPCs, and an `AgentUiService`
that correlates them ([extension-ui-rpc.md](extension-ui-rpc.md)). **Nothing consumes it.**
`packages/client` has no `agent_ui` surface at all, so an extension dialog is received, retained, and
broadcast by the daemon to zero listeners — and the agent's turn blocks until Pi's own timeout fires.

This scope defines the **entire non-rendering consumer**: an SDK surface on `PiStudioClient`, and a
pure, framework-agnostic state module that owns every hard problem in this feature. It deliberately
ships **no UI**.

That split is the point. Every genuinely difficult thing here is state logic, not pixels:
reconnect rehydration ordering, first-answer-wins across multiple clients, timeout display under
clock skew, and safe handling of methods Pi has not invented yet. Solved and unit-tested here — under
Node, with no jsdom (this repo's runner has none) — the sibling UI scope becomes component work over a
tested state machine, with no state decisions left to improvise.

**Consequence, stated plainly:** this scope produces **zero user-visible change**. It is
infrastructure held for exactly one sprint, and it is only worth doing if the UI scope follows
promptly rather than parking.

## Public contract

### SDK surface (`packages/client`)

Added to `PiStudioClient`, matching the facade's existing shapes (`onAgentUpdate`/`onAgentStream` for
subscriptions returning an unsubscribe thunk; `daemon.request(...)` under the hood):

| Member | Shape | Notes |
|---|---|---|
| `onAgentUiRequest(handler)` | `(event: AgentUiRequest, meta: AgentUiEventMeta) => void` → `() => void` | `meta` mirrors the `AgentStreamEventMeta` precedent |
| `onAgentUiResolved(handler)` | `(event: AgentUiResolved) => void` → `() => void` | |
| `respondToUi(uiRequestId, response)` | `Promise<AgentUiRespondResult>` | **returns** the domain outcome, never throws on it |
| `listAgentUi(agentId?)` | `Promise<{ pending: AgentUiPendingRequest[]; surfaces: AgentUiSurface[] }>` | throws `AgentUiError` on `payload.ok === false` |
| `extensionUiAvailable()` | `boolean` | reads `serverInfo.features.extensionUi` |

Plus type guards `isAgentUiRequest` / `isAgentUiResolved` for narrowing raw `onSessionMessage`
traffic, mirroring `isProviderAuthFlowEvent` — and `isAgentArchived` / `isAgentDeleted` for the two
lifecycle messages § Agent lifecycle prunes on. Those two are exported rather than kept module-local
(the `isFileChangedMessage` convention) because they narrow real `sessionMessageSchema` union members
with published protocol schemas, and because the same narrowing is duplicated today in two separate
web-client hooks — a third copy in the renderer is worth pre-empting.

```ts
/** Local-clock anchor. The daemon may run on another host; see § Timeout display. */
export interface AgentUiEventMeta {
  receivedAt: number;
}

/**
 * First-answer-wins is a NORMAL outcome here, not an exception — see § Error convention.
 * `reason` carries the daemon's error string VERBATIM. `"not_found"` usually means another client
 * answered first, but the daemon returns the same string for a bogus id or an already-swept agent —
 * the client cannot distinguish these, so the SDK must not relabel it with a claim it can't back
 * (e.g. `"already_resolved"`).
 */
export type AgentUiRespondResult =
  | { ok: true }
  | { ok: false; reason: "not_found" | "unsupported" | string };
```

`agentId` is deliberately **not** a parameter of `respondToUi`: the wire keys responses on the
daemon-minted `uiRequestId` alone. Nor does this scope add an `agent(id).respondToUi(...)` handle
method — `listAgentUi(agentId?)` already covers the per-agent case with one method instead of two.

### Pure state module

`packages/client/src/agent-ui-state.ts` — no framework, no DOM, no timers, no I/O. A reducer plus
selectors:

```ts
reduce(state: AgentUiState, action: AgentUiAction): { state: AgentUiState; effects: AgentUiEffect[] }
```

- `AgentUiAction` — `{ type: "ui_request", event, meta }` | `{ type: "ui_resolved", event }` |
  `{ type: "snapshot", pending, surfaces }` | `{ type: "disconnected" }` |
  `{ type: "agent_removed", agentId }` (see § Agent lifecycle) |
  `{ type: "respond_sent", requestId, response }` | `{ type: "respond_failed", requestId }`
  (sprint-067/task-005, see below)
- `AgentUiState` — `pending` keyed by `requestId` (daemon-minted, globally unique); `surfaces` keyed
  by the composite `(agentId, surfaceKey)`, because `surfaceKey` is only unique within an agent;
  `resolved` keyed by `requestId`, same as `pending` (task-005)
- `AgentUiEffect` — returned, never performed: `{ type: "replace_composer_text", agentId, text }` |
  `{ type: "notify", agentId, message, level }`
- Selectors — `pendingForAgent`, `pendingByAgent` (the attention-badge derivation, so badging is a
  subscription rather than UI logic), `surfacesForAgent`, `resolvedForAgent` (task-005, same
  `createdAt`/`requestId` ordering as `pendingForAgent`), `remainingMs(entry, now)`

**Resolved retention (task-005).** `ui_resolved` moves the entry from `pending` into `resolved`
instead of deleting it, so a resolved dialog can collapse in place and stay visible for the life of
the page — the daemon has no resolved history to re-serve (`agent_ui_list_response` only ever
carries live `pending`/`surfaces`), so once a client drops an entry on resolution there is no way to
recover it later, including after this same client's own reconnect. Kept at its **original**
`createdAt` (no `resolvedAt` field), so a list merging `pendingForAgent`/`resolvedForAgent` by that
key never reshuffles when an entry resolves. Bounded per agent (`RESOLVED_HISTORY_LIMIT = 50`) —
page-lifetime state still must not grow without limit against a chatty extension. `respond_sent`/
`respond_failed` track one client's own in-flight `respond` (`pending[id].submitting`) for a
pressed-control spinner; `select`/`confirm` answers are retained on the resolved entry for display,
`input`/`editor` answers never are — a storage rule, since those two methods can carry a secret the
user typed and the value must be unrepresentable in state, not merely unrendered by convention.

### Controller

`createAgentUiController(client)` → `{ getState, subscribe, respond, resync, dispose }`, where
`subscribe(listener: (state, effects) => void)` is also how effects reach a consumer — the reducer
returns them, the controller forwards them per transition, and nobody performs them here. A small
framework-agnostic wiring layer that owns everything a consumer could get wrong:

- **The subscribe-then-list ordering** described in § Rehydration. Without it, every client (web,
  and later mobile/desktop) reimplements the same ordering, and one of them gets it subtly wrong.
- **Reconnect detection.** The controller subscribes to the client's connection-state events itself
  and re-runs the snapshot sequence automatically when the connection reopens. This is NOT left to
  the consumer: § Disconnect marks surviving dialogs `answerable: false`, and only a fresh snapshot
  re-enables them — a consumer that forgot to trigger resync would ship permanently disabled dialogs
  that fail silently, only in the field, only after a network blip. The public `resync()` remains as
  an escape hatch but is never required. (Transport-lifecycle coupling is not a cost here: the
  controller already takes `client` as its dependency and is the impure wiring layer by design —
  purity lives in the reducer.)
- **Agent-lifecycle pruning.** The controller feeds `agent_removed` from the `agent_archived` /
  `agent_deleted` session messages (see § Agent lifecycle for the wire detail, and for why the
  daemon cannot do this for us).
- `dispose()` tears down all of the above subscriptions.

`respond` dispatches `respond_sent` before the RPC (so `pending[id].submitting` can drive a
pressed-control spinner immediately) and `respond_failed` only on a domain failure (task-005); it
still delegates the actual outcome to `client.respondToUi` and lets the resulting
`agent_ui_resolved` broadcast drive removal into `resolved`. **No optimistic resolution** — an
optimistic dismissal that loses the first-answer-wins race would show the user a resolved dialog
that the agent never received an answer for.

### Capability gating

Every call site gates on `extensionUiAvailable()`. Against an older daemon the family is absent, and
an ungated `listAgentUi` earns an `rpc_error`. Mirrors `providerAuthCapable` (`ConnectionBar.tsx:84`).
Implemented over the existing `DaemonClient.hasFeature()`. Deliberately NOT named
`supportsExtensionUi()`: that name already exists in this codebase as a **provider** capability flag
(`AgentCapabilityFlags.supportsExtensionUi`, `provider-manifest.ts`) with different semantics —
"this provider forwards UI events" vs. "this daemon has the RPC family" — and reusing it would
invite exactly that confusion.

### Error convention

`agent_ui_respond_response` and `agent_ui_list_response` both carry `ok`/`error` **inside `payload`**,
so — exactly as `provider-auth-rpc.md` warned and `ProviderAuthError` exists for — a caller that only
catches `RpcError` reads failure as success. This scope diverges from that family's remedy on one
of the two, deliberately:

- **`listAgentUi` throws `AgentUiError`.** A snapshot that failed is genuinely exceptional.
- **`respondToUi` returns `AgentUiRespondResult`.** `error: "not_found"` is what a client sees when
  another client answered first — the expected outcome of the broadcast model, in normal multi-client
  operation. Throwing would put a routine race in the exception path and force `try`/`catch` around
  the happy path. Returning it makes the outcome impossible to ignore without a type error, which is
  the property `ProviderAuthError` was reaching for. The daemon's reason string is forwarded
  verbatim, never relabeled (see the type's doc comment).

## Behavior & algorithms

### Routing taxonomy

Pi documents two categories (dialog, fire-and-forget) and the daemon models exactly that. The client
needs **three**, because two fire-and-forget methods are not surfaces:

| Category | Methods | Predicate | Handling |
|---|---|---|---|
| Dialog | `select`, `confirm`, `input`, `editor` | `expectsResponse` | enters `pending`; MUST be answerable |
| Retained surface | `setStatus`, `setWidget`, `setTitle` | `surfaceKey` present | upsert, or delete when `removed` |
| Transient imperative | `notify`, `set_editor_text` | neither | emit effect, retain nothing |

```
expectsResponse        → dialog
surfaceKey && removed  → delete surface
surfaceKey             → upsert surface
otherwise              → transient effect
```

Classification is **not** keyed on `method`. A flat `method → handler` map cannot express
`set_editor_text` (mutates a composer, renders nothing) and gives no safe default for the unknown
methods below. `method` matters only *within* a category, at render time — i.e. not in this scope.

The daemon already expresses the third row correctly and for free: no `surfaceKey` means nothing is
retained, so `agent_ui_list` can never feed a reconnecting client a stale toast.

### Rehydration (subscribe-then-list)

Dialogs survive a client disconnect by design ([extension-ui-rpc.md](extension-ui-rpc.md) — a tab
reload must not kill the agent's turn), so a reconnecting client must recover them.

1. Attach the `agent_ui_request` / `agent_ui_resolved` handlers **first**, queueing events.
2. Call `listAgentUi()` (no `agentId` — one call covers every agent).
3. On the snapshot: **replace** `pending` and `surfaces` wholesale; **discard** queued dialog and
   surface events; **apply** queued transient events (their effects fire); reset `answerable: true`
   on every entry. Apply subsequent events live.

Attach-first matters because an event delivered just after the response frame must not be dropped.
The merge rules follow from ordered delivery: the WebSocket is a single ordered stream (TCP-backed on
both the direct and relay paths), and the daemon composes `agent_ui_list_response` from state that
postdates every broadcast already sent on that socket. Therefore:

- **Every queued dialog/surface event is already reflected in the snapshot** — replaying it after
  the snapshot can only regress state or no-op. Concretely: surfaces are last-write-wins on
  `(agentId, surfaceKey)`, not deduped by `requestId` (each upsert carries a fresh id), so a drained
  older upsert would silently roll a widget back until the extension's next update. Discard, don't
  drain.
- **Queued transients are NOT in any snapshot** (nothing retains them) and were received on this
  connection, so they are genuinely new — apply them, exactly once.
- **No tombstones.** A `resolved` for an unknown `requestId` is a plain no-op in the reducer — there
  is no pending entry to move into `resolved`, so nothing is synthesised; ordered delivery makes the
  "resolved raced ahead of its snapshot twin" scenario unconstructible from the wire, so no
  bookkeeping exists for it.

### Timeout display

Pi's docs are explicit: the agent auto-resolves on timeout and *"the client does not need to track
timeouts."* So this scope **renders a countdown, never acts on one** — dismissal is driven
exclusively by `agent_ui_resolved`. Two clients running independent expiry logic would diverge from
each other and from the agent.

`remainingMs` is anchored on `meta.receivedAt` (local clock) for live events. Entries recovered from
a snapshot have only the daemon's `createdAt`, which is `wireTimestampSchema` (epoch-ms **or** ISO
string) produced on a possibly-different host: that residual clock skew is **accepted and
documented**, not silently inherited — a countdown is a legibility affordance here, not a control.

### Unknown methods

`method` is an open string, and the handling is deliberately asymmetric:

- Unknown **fire-and-forget** → ignored, logged once per method (mirrors the daemon's own stance).
- Unknown **dialog** (`expectsResponse: true`, unrecognised `method`) → **still enters `pending`**,
  `method` stored verbatim.

The second is a requirement, not polish. Dropping an unrecognised dialog wedges the agent's turn
until Pi's timeout, for a method the daemon already forwards correctly. Note the reducer carries no
"unknown" flag — that would require a known-methods table, which § Routing taxonomy prohibits.
"Unknown" is a render-time fact: the UI scope's registry lookup missing for `entry.method` IS the
signal to render a generic answerable card (raw payload + Cancel). This is the client-side twin of
the daemon's forward-compatibility guarantee.

### Transient effects

- **`set_editor_text` → always replace.** Product decision: matches Pi's own semantics, where
  `pasteToEditor` delegates to `setEditorText` with no paste handling, and is predictable for
  extension authors. The effect carries `{ agentId, text }`; applying it is the UI scope's job.
- **`notify` → level forwarded verbatim** (`info` | `warning` | `error`). The SDK does **not** collapse
  it onto a toast variant: `ToastVariant` today is `default | success | error` with no `warning`, and
  baking a lossy mapping in here would hide that gap. Adding the variant is the UI scope's call.

### Disconnect

On transport drop, pending entries are **not** cleared — the daemon still holds them. They are marked
`answerable: false` so a view can disable inputs rather than offer a button whose RPC cannot leave.
The reconnect snapshot (§ Rehydration, driven by the controller — never by the consumer) reconciles
authoritatively and resets `answerable: true` on every surviving entry; `disconnected` is a one-way
door only until the next snapshot.

### Agent lifecycle

When an agent is archived or deleted, the daemon sweeps its extension-UI state — but the two halves
reach clients differently, and one does not reach them at all:

- **Dialogs**: the sweep broadcasts `agent_ui_resolved` per pending entry
  (`agent-ui-service.ts` sweep path) — clients dismiss in step, nothing to do here.
- **Surfaces**: the sweep is `surfaces.delete(agentId)` with **no broadcast**. A connected client —
  which never re-snapshots — would retain the archived agent's status strip and widgets forever.

So surface pruning is client-side by necessity: the reducer's `agent_removed` action drops all
surfaces (and, defensively, pending entries) for that agent, and the controller feeds it from the
**`agent_archived` / `agent_deleted`** session messages — the two real `sessionMessageSchema` union
members (`messages.ts`'s `agentArchivedSchema` / `agentDeletedSchema`) that the daemon fans out to
every session on archive/delete (`bootstrap.ts` and `dev-bootstrap.ts`, the same
`manager.subscribe` block that triggers the server-side sweep).

**Not `agent_update`.** `AgentManager.archiveAgent`/`deleteAgent` call `broadcastArchived`/
`broadcastDeleted` **exclusively**; neither touches the `agent_update`-emitting `broadcast(record)`
path, so archiving an agent produces **zero** `agent_update` traffic and a pruner wired to
`PiStudioClient.onAgentUpdate` (which filters `type === "agent_update"`) would never fire. Getting
this wrong is silent: dialogs would still clear, because the daemon broadcasts `agent_ui_resolved`
for those, and only the surfaces would leak — invisibly, until someone noticed an archived agent's
status strip still pinned to a live view.

`PiStudioClient` exposes no `onAgentArchived`/`onAgentDeleted` facade, and this scope deliberately
does **not** add one: these are pre-existing lifecycle events this scope merely *observes*, not part
of the `agent_ui_*` family it owns, and adding facade subscriptions for them would invite the same
for `agent_status`/`agent_list` next. Instead the controller narrows
`client.connection.onSessionMessage` with the two exported guards from § Public contract — the
established convention for message types with no dedicated facade method (`use-checkout-status.ts`,
`use-file-watch.ts`, `use-explorer-watch.ts` all do exactly this).

This is the one piece of agent-lifecycle logic in this scope, and it exists because the server's
sweep is silent for surfaces — if a future server change broadcasts surface removals on sweep, this
becomes a harmless no-op, not a conflict.

## Data & persistence touchpoints

None. All state is in-memory and client-side; the daemon is the authority and re-derives it on demand
via `agent_ui_list`. No new `$PI_STUDIO_HOME` files, no protocol changes — this scope consumes the
sprint-066 wire contract **exactly as shipped** and adds no schema.

## Error handling & edge cases

- Ungated call against a daemon without `features.extensionUi` → `rpc_error`; prevented by
  § Capability gating.
- `respondToUi` for an id already resolved → `{ ok: false, reason: "not_found" }`, which is a
  normal race, not an error to surface as one (see § Error convention on why it isn't relabeled).
- `agent_ui_resolved.reason` is an open string — never switched on exhaustively.
- A surface `removed` for a `surfaceKey` never seen → no-op, not an error.
- Snapshot arriving while a second snapshot is in flight → last write wins; the controller serialises
  its own snapshot calls so this cannot come from within.
- Agent archived/deleted while a dialog is pending → the daemon sweeps and broadcasts `resolved`
  for dialogs; surfaces are swept **silently** and pruned client-side via `agent_removed`
  (§ Agent lifecycle).

## New/changed files

| File | Change |
|---|---|
| `packages/client/src/pistudio-client.ts` | SDK surface: two subscriptions, two RPCs, capability check, four guards (`isAgentUiRequest`/`isAgentUiResolved` + `isAgentArchived`/`isAgentDeleted`), `AgentUiError` |
| `packages/client/src/agent-ui-state.ts` | **new** — pure reducer, effects, selectors |
| `packages/client/src/agent-ui-state.test.ts` | **new** — reducer/selector unit tests (Node) |
| `packages/client/src/agent-ui-controller.ts` | **new** — subscribe-then-list wiring, reconnect resync, agent-lifecycle pruning |
| `packages/client/src/agent-ui-controller.test.ts` | **new** — controller tests over the scripted transport (`push`/`drop`) |
| `packages/client/src/index.ts` | exports for the above — verify only; it already re-exports `pistudio-client.js` wholesale |
| `packages/server/src/daemon/index.ts` | one line: re-export `dev-bootstrap.js`. Server's `exports` map allows the root subpath only and the daemon barrel re-exports only `bootstrap.js`, so `startDevDaemon` is otherwise unreachable from the E2E below |
| `packages/cli/src/agent-ui-sdk-e2e.test.ts` | **new** — SDK + controller against a real dev daemon. Lives in `cli` because `client` and `server` have **no** dependency edge in either direction, while `cli` already depends on (and references) both — so this costs zero new edges |
| `packages/client/AGENTS.md`, root `AGENTS.md` | document the new surface, and state plainly that nothing renders it yet |

## Dependencies on other specs

- [extension-ui-rpc.md](extension-ui-rpc.md) — the wire contract; consumed unchanged.
- [provider-auth-rpc.md](provider-auth-rpc.md) — payload-borne domain-error precedent (§ Error
  convention documents where and why this scope diverges).
- Mock provider's scripted UI emitter (sprint-066/task-002) — the test harness, reused as-is.

## Acceptance criteria

- [ ] `respondToUi` answers a mock-provider `select` dialog end-to-end against a real in-process
      daemon; the provider observes the value.
- [ ] A second `respondToUi` for the same id returns `{ ok: false, reason: "not_found" }` and
      does **not** throw.
- [ ] `listAgentUi` throws `AgentUiError` (not a silent empty result) when `payload.ok === false`.
- [ ] Reducer classifies all nine documented Pi methods into the three categories of § Routing
      taxonomy, driven only by the wire predicate — no method table.
- [ ] An unknown **dialog** method enters `pending` with `method` stored verbatim and no
      unknown-flag; an unknown fire-and-forget method is ignored and logged once.
- [ ] Controller subscribes before listing: an `agent_ui_request` emitted *during* the in-flight
      `listAgentUi` is present in state exactly once afterwards.
- [ ] On snapshot, queued surface events are discarded (an older queued upsert never overwrites the
      snapshot's newer value) and queued transient events emit their effects exactly once.
- [ ] A `resolved` for an unknown `requestId` is a no-op — no throw, no state change.
- [ ] `setStatus` upsert then clear (`removed: true`) leaves no surface; a cleared surface is absent
      from a subsequent snapshot.
- [ ] Two independent SDK clients both see one dialog; one answers; the other observes `resolved`
      and its `respondToUi` reports `not_found`.
- [ ] Disconnect leaves pending entries present and `answerable: false`; the controller re-syncs on
      reconnect **without any consumer call** and the surviving entries flip back to
      `answerable: true`.
- [ ] `agent_removed` (fed from an archive transition) drops the agent's surfaces; without it they
      would be retained forever, since the daemon's surface sweep broadcasts nothing.
- [ ] `remainingMs` is anchored on `meta.receivedAt` for live events; no code path dismisses an
      entry on timeout.
- [ ] `set_editor_text` emits one `replace_composer_text` effect; `notify` forwards `warning`
      verbatim without collapsing it to an existing toast variant.
- [ ] `pendingByAgent` reports exactly the agents with unanswered dialogs (the attention-badge
      input).
- [ ] Every new call site gates on `extensionUiAvailable()`.
- [ ] Real-Pi smoke: a `@juicesharp/rpiv-ask-user-question` dialog answered through
      `respondToUi`, with the extension's completion observed.
- [ ] Reducer and selector tests run under Node with no jsdom.
- [ ] `packages/client/AGENTS.md` documents the surface, and states plainly that nothing renders it
      yet.

## Out of scope

- **All rendering** — dialog components, status strip, widget blocks, attention-badge display,
  Esc-stack integration: sibling UI scope.
- **Toast `warning` variant** — the gap is identified here; adding it belongs with the toasts.
- **`setTitle` → `record.title` promotion / session auto-naming.** Considered and dropped as
  over-engineering for now: it was the single exception to the daemon's payload-blindness (needing a
  spec carve-out, title pinning, and provenance labels). `setTitle` stays an ordinary retained
  surface. Nothing is foreclosed — surfaces are captured from this scope onward, so promotion can
  layer on later with no migration.
- **CLI mirror** (`pi-studio ui …`) — separate scope.
- **Timeline persistence of UI interactions** — ephemeral by design, per the server scope.
- **Tool-call permission approval** — still dormant, still its own family.

## Open questions

- [ ] Carried forward from [extension-ui-rpc.md](extension-ui-rpc.md): whether a bundled `core`-pack
      extension can emit a dialog *before* the daemon attaches its UI channel. The window is one
      provider constructor. The real-Pi smoke test above may observe it incidentally; if it is real,
      the fix is a bounded queue in the Pi adapter — server-side, and out of scope here.
