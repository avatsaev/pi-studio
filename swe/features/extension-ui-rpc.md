# Extension UI Bridge — Daemon RPC Surface (server side)

> Part of: [MAIN-SCOPE.md](../MAIN-SCOPE.md)
> Related scopes: [tool-permissions.md](tool-permissions.md) (adjacent family — see § Relationship to
> tool permissions), [agent-providers.md](agent-providers.md), [agent-sessions.md](agent-sessions.md),
> [mcp-server.md](mcp-server.md), [preinstalled-extensions.md](preinstalled-extensions.md),
> [../architecture/websocket-protocol.md](../architecture/websocket-protocol.md)

## Purpose

Pi extensions and custom tools ask the user things. In the TUI those are dialogs and overlays; over
`pi --mode rpc` — the only way this daemon ever runs Pi — they become a documented request/response
sub-protocol on stdio: `extension_ui_request` / `extension_ui_response` (Pi's `docs/rpc.md`
§ Extension UI Protocol). Today the daemon **answers every one of them with `{ cancelled: true }`** at
`packages/server/src/agent/providers/pi/agent.ts:127-142` (a POC stub whose own comment says so), and
silently drops the fire-and-forget half. Consequence: every interactive extension is dead weight
under Pi-Studio. `@juicesharp/rpiv-todo` — which the daemon installs itself, as a `core`-pack member
(`extensions/curated-packs.ts`, `preinstalled-extensions.md`) — renders no panel, because its overlay
rides `setWidget` and the daemon drops it. Any user-installed interactive extension fares worse:
`@juicesharp/rpiv-ask-user-question` (whose RPC fallback is built precisely for hosts like this one)
asks nothing, and a permission-style `select` self-denies. The daemon is cancelling UI it shipped.

This scope defines the **entire server side** of the bridge: one generic, method-agnostic wire family,
a provider-neutral channel on the session contract, and the daemon service that correlates it. The
design goal: **any extension that works in any Pi RPC host works here unmodified, across Pi's entire
documented UI surface — and the bridge degrades safely, never destructively, on methods it has never
seen.** Unknown future fire-and-forget methods pass through with zero changes. A future *dialog*
(blocking) method is the one case full auto-compatibility is impossible — Pi's wire does not mark
which methods block — and it costs exactly a one-constant adapter update (§ Behavior, unknown-methods
bullet, and § Error handling for the failure mode until that update ships). The daemon transports and
correlates; it never interprets a dialog payload.

**No client SDK, no web-client, no CLI work in this scope.** A sibling UI scope will consume this
contract. The deliverable is verifiable with protocol-level tests against the daemon alone, driven by
the mock provider (§ Acceptance criteria).

## Why a new family and not the dormant permission family

`tool-permissions.md` § Question-permission bridge anticipated routing Pi dialogs through
`agent_permission_request`. Implementation should **not** take that route. Verified state of that
family: `PermissionService.requestPermission` has **zero production callers** (only
`permissions.test.ts`), `cancelPending` likewise, and the Pi provider's `getPendingPermissions()`
returns `[]` with `respondToPermission()` a fire-and-forget `notify` that tracks nothing
(`providers/pi/agent.ts:313-320`). So there is no working pipeline to extend — the choice is between
two greenfield shapes, and the permission shape is the wrong one:

1. **Half of Pi's UI surface has no response at all.** `notify`, `setStatus`, `setWidget`, `setTitle`,
   `set_editor_text` are fire-and-forget. A "permission" that is never answered and gates nothing is
   a contradiction; routing them through a decision family would require a second channel anyway,
   splitting one Pi concept across two families.
2. **`setStatus`/`setWidget`/`setTitle` are state, not events.** Last-value-wins, keyed, clearable. A
   reconnecting client must see the *current* todo panel, not miss the update. Permissions have no
   retention concept.
3. **Permission vocabulary is decision-shaped.** `requestPermission` defaults
   `responses: ["allow","deny"]`; `input`/`editor` return free text and `select` returns an arbitrary
   option string.
4. **Forward compatibility is the whole point.** An unknown future method must pass through opaquely.
   Mapping into permission semantics requires per-method knowledge in the daemon — exactly what this
   scope forbids outside the Pi adapter.

Permissions stay reserved for genuine mode-gated tool-call approval (still unimplemented, still
dormant, out of scope here). Overlap is possible and harmless: Pi's own docs use `select` for
`"Allow dangerous command?"`, so an approval-looking dialog may arrive on this channel. The daemon
does not try to detect that; a client may choose to render such a payload distinctively.
`tool-permissions.md` is amended to point here for the dialog half.

## Public contract

### Wire messages (flat snake_case, append-only, wrapped in the `session` envelope)

| Message | Direction | Payload | Notes |
|---------|-----------|---------|-------|
| `agent_ui_request` | S→C (broadcast) | `{ requestId, agentId, method, expectsResponse, payload, surfaceKey?, removed?, timeoutMs?, createdAt }` | One per `extension_ui_request`. `requestId` is **daemon-minted** (see below). `payload` is opaque |
| `agent_ui_resolved` | S→C (broadcast) | `{ requestId, agentId, reason }` | `reason` ∈ `answered` \| `cancelled` \| `timeout` \| `aborted`. Lets every client dismiss |
| `agent_ui_respond_request` | C→S | `{ requestId, uiRequestId, response }` | `requestId` is the RPC correlation id; `uiRequestId` is the daemon-minted id from the broadcast |
| `agent_ui_respond_response` | S→C | `{ requestId, payload: { ok, error? } }` | `error` ∈ `not_found` \| `unsupported` |
| `agent_ui_list_request` | C→S | `{ requestId, agentId? }` | Reconnect catch-up; omit `agentId` for all agents |
| `agent_ui_list_response` | S→C | `{ requestId, payload: { ok, pending: AgentUiPendingRequest[], surfaces: AgentUiSurface[], error? } }` | `surfaces` contains live surfaces only — cleared ones are gone |

Response bodies live under `payload` (the `agentRewindResponseSchema` / `provider_auth_*` shape):
`ws/router.ts` stamps `requestId` at the top level, so handlers never set it. The two broadcast
pushes are flat — they are not responses and carry no correlation.

**The wire `requestId` is minted by the daemon (UUID), never the provider's id.** Provider request
ids are provider-scoped by contract — Pi's happen to be UUIDs, but the docs only promise uniqueness
per process, and the mock provider (this family's designated test producer) uses small counters. Two
agents are two processes; a daemon-global map keyed by provider ids would let one agent's dialog
shadow another's and route an answer to the wrong process. The service therefore keeps a private
`wire requestId → (agentId, providerRequestId, session)` mapping and providers never see wire ids.

```ts
interface AgentUiPendingRequest {
  requestId: string;                   // daemon-minted UUID — globally unique across agents/providers
  agentId: string;
  method: string;                      // verbatim Pi method name
  expectsResponse: boolean;            // false ⇒ informational only, never answerable
  payload: Record<string, unknown>;    // verbatim, minus Pi's own type/id/method envelope fields
  surfaceKey?: string;                 // present ⇒ retained state (see AgentUiSurface)
  timeoutMs?: number;                  // provider-supplied deadline hint, when Pi sent one
  createdAt: number | string;         // wireTimestampSchema (messages.ts) — daemon emits epoch ms
}

/** Last-value-wins retained surface (status line, widget, title). Deleted when cleared. */
interface AgentUiSurface {
  agentId: string;
  method: string;
  surfaceKey: string;                  // adapter-namespaced (see § Provider contract)
  payload: Record<string, unknown>;
  updatedAt: number | string;         // wireTimestampSchema — daemon emits epoch ms
}

/** Client answer. Mirrors Pi's response vocabulary; forwarded to the provider (see stamping rule). */
interface AgentUiResponse {
  value?: string;                      // select / input / editor
  confirmed?: boolean;                 // confirm
  cancelled?: boolean;                 // dismiss any dialog
}
```

`AgentUiResponse` is deliberately **permissive** (all fields optional, `.passthrough()`) rather than a
strict union keyed on `method`. Method→response-shape validation is Pi's business, not ours; a strict
union would reject a shape a future Pi method introduces, and the failure mode of over-strictness is
the worst one available — a blocked extension waiting forever on a response the daemon refused to
forward. A nonsensical answer resolves the dialog with `undefined`/`false`, which is exactly what an
extension's own cancel path already handles.

**Envelope-stamping rule (security).** Because the response body is passthrough, a client can include
`id` or `type` keys in it. Pi's protocol routes responses purely by `id` (`rpc.md`: "The `id` must
match the request"), so a spread in the wrong order — `{ id, ...response }` — would let a client
answer dialog A while actually resolving dialog B, or corrupt the frame type. The adapter MUST stamp
protocol envelope fields **after** spreading the client body (`{ ...response, id }`, with `type` set
by the transport last), so they can never be overridden. Everything else in the body is forwarded
verbatim.

### Registration style

- **The four request/response pairs** (`agent_ui_respond_*`, `agent_ui_list_*`) get real Zod schemas
  in `packages/protocol/src/messages.ts` plus `sessionMessageSchema` union membership.
- **The two broadcast pushes** (`agent_ui_request`, `agent_ui_resolved`) also get real schemas and
  union membership, following `agent_permission_request` / `agent_permission_resolved`
  (`messages.ts:355-370`) — the closest analogue: agent-scoped, broadcast to all clients, awaiting a
  client decision. This is **not** the `sessionMessageBaseSchema` passthrough family: that convention
  (`messages.ts:1209-1215`) governs *per-session subscription* pushes — `checkout_status_update`,
  `file_changed`, `provider_auth_flow_event` — which these are not. Opacity is achieved *inside* the
  schema (`payload: z.record(z.unknown())`, every object `.passthrough()`), so the envelope stays
  typed while the payload stays future-proof.
- Names are **flat snake_case**, per the dominant convention and the freshest precedent
  (`provider_auth_*`, sprint-055). The permission family's dotted canonical
  (`agent.permission.respond.request` + legacy flat alias) is the older minority style; do not copy it.
  No aliases are needed for a brand-new family.
- New schemas use `.passthrough()` throughout. (The permission schemas at `messages.ts:355-392`
  predate that rule and lack it — do not use them as the style model for anything but union placement.)

### Capability flags

- `SERVER_FEATURES.extensionUi` added to `packages/protocol/src/client-capabilities.ts` (currently 8
  keys: `providersSnapshot`, `checkoutGithubSetAutoMerge`, `daemonStatusRpc`,
  `terminal-restore-modes`, `rewind`, `checkoutRefresh`, `extensionPacks`, `providerAuth`) with its
  `SERVER_FEATURE_COMPAT` entry. The daemon already folds every `SERVER_FEATURES` value into
  `server_info.features`, so no emission code is needed — but `client-capabilities.test.ts:20-33`
  pins the **exact sorted key set** and will fail until updated.
- `AgentCapabilityFlags` (`packages/protocol/src/provider-manifest.ts:18-34`) gains
  **optional** `supportsExtensionUi?: boolean`; `PI_CAPABILITIES` (`providers/pi/agent.ts:50-58`) and
  the mock's `MOCK_CAPABILITIES` set it `true`. Optional + already `.passthrough()` ⇒ no compat risk.
- **No new `agentStatusEnum` value.** `initializing|idle|running|error|closed` (`messages.ts:117`) is
  a strict `z.enum`; adding `awaiting_input` would make new daemons emit a status older clients fail
  to parse. Attention state is derived by clients from `agent_ui_request`/`agent_ui_resolved` plus
  `agent_ui_list_*`, which needs no enum change.

### Error convention

Verified against `ws/router.ts`: a handler's return value is wrapped and stamped with `requestId`; a
throw becomes `rpc_error` with a fixed code. Only `unknown_message_type` and `handler_error` exist and
**a handler cannot choose one**. So every domain failure here is payload-level
`{ ok: false, error: "<reason>" }`, per the `provider_auth_*` / `file_watch_subscribe_response`
precedent. `handler_error` stays reserved for genuine unexpected exceptions.

### Provider contract extension (provider-neutral)

Added to `AgentSession` in `packages/server/src/agent/provider-contract.ts`, both **optional** so
providers opt in and no existing implementation breaks:

```ts
onUiRequest?(cb: (req: ProviderUiRequest) => void): Unsubscribe;
respondToUi?(providerRequestId: string, response: ProviderUiResponse): void;

interface ProviderUiRequest {
  requestId: string;                   // provider-scoped id (Pi's `id`) — NEVER a daemon-global key
  method: string;                      // verbatim
  expectsResponse: boolean;            // the provider decides; Pi ⇒ the four dialog methods
  payload: Record<string, unknown>;    // verbatim, envelope fields stripped
  surfaceKey?: string;                 // present ⇒ retained, last-value-wins under this key
  removed?: boolean;                   // true ⇒ delete the retained surface instead of updating it
  timeoutMs?: number;
}
interface ProviderUiResponse { value?: string; confirmed?: boolean; cancelled?: boolean }
```

**All Pi-specific knowledge lives in the Pi adapter, none in the service.** Specifically the adapter —
not `AgentUiService` — owns:

- **Which methods block**: `select`/`confirm`/`input`/`editor` (one constant).
- **Surface keys, namespaced by method**: `setStatus → "status:" + statusKey`,
  `setWidget → "widget:" + widgetKey`, `setTitle → "title"`. The namespace prefix is mandatory, not
  cosmetic: Pi's own docs use the *same* key for both kinds — `statusKey: "my-ext"` and
  `widgetKey: "my-ext"` (`rpc.md:1273`, `:1289`) — since the natural pattern is one extension using
  its own name everywhere. Un-namespaced, an extension's status tick would silently delete its
  widget (rpiv-todo's panel, the flagship use case), and any extension with a statusKey literally
  `"title"` would clobber the window title.
- **Surface clearing**: Pi's protocol clears by omission — `statusText: undefined` clears a status
  entry, `widgetLines: undefined` clears a widget (`rpc.md:1278`, `:1295`). The adapter maps those
  forms to `removed: true`; the service deletes the key and still broadcasts, so live clients clear
  in step and `agent_ui_list_response.surfaces` never accumulates dead husks. (Field names
  `statusKey`/`widgetKey`/`statusText`/`widgetLines`, `timeout` in ms, and the `notifyType` enum are
  all confirmed against the **installed** `@earendil-works/pi-coding-agent` build's `rpc.md`, not
  just upstream docs.)
- **`set_editor_text` is transient, deliberately not retained**: it injects text into a *live*
  editing surface; replaying an hours-old prefill into a freshly connected client would clobber
  whatever the user is typing. Clients act on it live or ignore it.
- **The `extension_ui_response` wire shape**, including the envelope-stamping rule above.

The service sees only the generic struct. This keeps the provider-isolation invariant intact (root
`AGENTS.md` § Key invariants #3) *and* is what makes the family generic: a future provider with a
different interactive protocol implements the same two members and the whole stack above it works
untouched.

`AgentStreamEvent` is deliberately **not** used. It is a closed 10-kind discriminated union with no
escape hatch (`messages.ts:258-305`) and it is timeline-persisted; UI requests are ephemeral,
out-of-band, and must never enter the append-only timeline.

### MCP mirror

Following `list_pending_permissions` / `respond_to_permission` (`agent/mcp-server.ts:247-260`):

| Tool | Params | Returns |
|------|--------|---------|
| `list_pending_ui_requests` | `{ agentId?: string }` | `{ ok: true, requests: AgentUiPendingRequest[] }` |
| `respond_to_ui_request` | `{ requestId: string, response: AgentUiResponse }` | `{ ok: true }` \| `{ ok: false, error: "unknown_ui_request" }` |

`requestId` here is the daemon-minted id, same as the WS wire. The error string differs from the WS
side's `not_found` on purpose: each surface follows its own precedent — MCP's `unknown_permission`
style vs. the WS payload-error style — rather than inventing a third convention.

Rationale beyond symmetry: it lets a parent agent unblock a child agent's questionnaire, which is
otherwise a deadlock in an orchestrated run (`subagents.md`).

### New/changed files

| File | Responsibility |
|------|----------------|
| `packages/protocol/src/messages.ts` (+ tests) | Six schemas + four union entries (both pushes and both RPC pairs) |
| `packages/protocol/src/client-capabilities.ts` (+ test) | `extensionUi` feature flag + COMPAT entry; exact-key-set test update |
| `packages/protocol/src/provider-manifest.ts` | Optional `supportsExtensionUi` capability flag |
| `packages/server/src/agent/provider-contract.ts` | `onUiRequest` / `respondToUi` + the two provider-neutral types |
| `packages/server/src/agent/providers/pi/agent.ts` | **Replace** the auto-cancel stub (lines 127-142) with translation onto the contract channel; own the dialog-method constant, namespaced surface-key derivation, clear-form detection, and envelope stamping; implement `respondToUi` |
| `packages/server/src/agent/providers/mock/mock-provider.ts` | Scripted UI-request emitter so the family is testable with no Pi process |
| `packages/server/src/agent/agent-ui/agent-ui-service.ts` | Wire-id minting, pending map, surface retention/clearing, broadcast, first-wins resolution, lifecycle sweeps |
| `packages/server/src/agent/agent-ui/agent-ui-rpc.ts` | `registerAgentUiHandlers(registry, deps)` — the established service+`-rpc` module pair (`registerProviderAuthHandlers` / `registerFileWatchHandlers`) |
| `packages/server/src/agent/agent-manager.ts` | Optional `onSessionAttached(agentId, session)` hook invoked from `attachSession()` — the single choke point every spawn/resume/import path already funnels through (`agent-service.ts:104`, `:228`), so no per-call-site threading and no path can forget to attach. Archive/delete cleanup rides the manager's **existing** subscriber events (`agent_archived` / `agent_deleted`) |
| `packages/server/src/agent/mcp-server.ts` | The two mirror tools |
| `packages/server/src/daemon/bootstrap.ts` + `dev-bootstrap.ts` | Construct the service, wire it to the manager hook + subscriber, register handlers in **both** (see § Dev daemon) |

## Behavior & algorithms

```
PiAgentSession.onEvent(raw):                      # replaces the auto-cancel stub
    if raw.type != "extension_ui_request": fall through to eventMapper (unchanged)
    method = raw.method
    emit to UI channel:
        requestId       = raw.id                                          # provider-scoped
        method          = method
        expectsResponse = method in { select, confirm, input, editor }    # one constant
        payload         = raw minus { type, id, method }
        timeoutMs       = raw.timeout
        surfaceKey      = setStatus -> "status:" + raw.statusKey
                          setWidget -> "widget:" + raw.widgetKey
                          setTitle  -> "title"
                          otherwise -> none            # notify, set_editor_text, unknown
        removed         = (setStatus and raw.statusText is absent)
                          or (setWidget and raw.widgetLines is absent)
    # NOTE: no response is written here. The daemon service answers, or nobody does.

PiAgentSession.respondToUi(providerRequestId, response):
    # Envelope fields stamped AFTER the client body — see the stamping rule (§ Public contract).
    transport.notify("extension_ui_response", { ...response, id: providerRequestId })

AgentUiService:
    pending:  Map<wireId /* daemon-minted UUID */, { agentId, providerRequestId, session, timer? }>
    surfaces: Map<agentId, Map<surfaceKey, AgentUiSurface>>
    channels: Map<agentId, Unsubscribe>

    attach(agentId, session):                          # AgentManager.onSessionAttached hook
        sweep(agentId, reason: "aborted")              # fresh process ⇒ old provider ids are dead;
                                                       # without this, a forced respawn (resume_agent
                                                       # always spawns fresh) leaves undead dialogs
        if not session.onUiRequest: return             # provider opted out; nothing to do
        channels[agentId] = session.onUiRequest(req => onProviderRequest(agentId, session, req))

    onProviderRequest(agentId, session, req):
        if req.surfaceKey:
            if req.removed: surfaces[agentId].delete(req.surfaceKey)
            else:           surfaces[agentId][req.surfaceKey] = { ...req, updatedAt: now }
        wireId = randomUUID()
        if req.expectsResponse:
            pending[wireId] = { agentId, providerRequestId: req.requestId, session }
            if req.timeoutMs: arm timer -> expire(wireId)
        broadcast agent_ui_request { requestId: wireId, agentId, ...req fields, createdAt: now }

    respond(uiRequestId, response):                    # first answer wins
        entry = pending[uiRequestId] or -> { ok:false, error:"not_found" }
        delete pending[uiRequestId]; clear timer
        try:     entry.session.respondToUi(entry.providerRequestId, response)
        finally: broadcast agent_ui_resolved { requestId: uiRequestId, agentId, reason:"answered" }
        # A respondToUi failure (dead stdin after a crash) is swallowed + logged: the answer was
        # accepted, so the resolution MUST still broadcast — otherwise every other client keeps a
        # ghost dialog that no longer exists in agent_ui_list_response.
        -> { ok:true }

    expire(uiRequestId):                               # Pi's own timeout elapsed
        drop from pending; broadcast agent_ui_resolved reason:"timeout"
        # Deliberately does NOT call respondToUi: Pi already auto-resolved its own timed dialog
        # (docs/rpc.md: "the agent-side will auto-resolve ... the client does not need to track
        # timeouts"). Answering again would target a dead id.

    sweep(agentId, reason):                            # archive / delete / re-attach — TERMINAL only
        for each pending of agent:
            best-effort session.respondToUi(providerRequestId, { cancelled: true })
            broadcast agent_ui_resolved { reason }
        drop the agent's pending entries, surfaces, and channel unsubscribe
```

- **Broadcast, not per-session.** An agent is a shared resource; any connected client may answer, and
  every client must see the resolution. Uses `bootstrap.ts`'s existing
  `broadcast(sessions, message)` + `getActiveSessions()` (which already spans direct **and** relay
  sessions), exactly as `agent_permission_request` does.
- **Disconnect must NOT cancel.** The opposite of `provider_auth_rpc.md`, and the difference is
  deliberate: an auth flow belongs to the socket that started it, whereas a pending question belongs
  to the *agent*. If the browser reloads mid-question, the dialog must survive so the same or another
  client can answer it — otherwise a tab refresh silently kills the agent's turn. This family
  therefore registers **no `SessionSubscriptions` entry**; there is nothing to dispose on close.
- **Interrupt touches nothing.** Interrupting a turn leaves pending dialogs *and* surfaces exactly as
  they are, for two reasons. Dialogs are not turn-scoped: `pi-background-tasks` (core pack) raises
  questions from outside any turn, and Pi's `interrupt` does not kill extensions — force-cancelling
  an unrelated background question on every Esc press would be destructive. Surfaces are
  agent-lifetime state: wiping rpiv-todo's widget because the user pressed Stop defeats the point of
  retaining it. If Pi's abort internally resolves a dialog, Pi emits no signal for that; a later
  answer then targets a dead id and is ignored — the same harmless race as the timeout case above.
- **Lifecycle sweeps are session-terminal only.** `sweep` runs on archive/delete (via the manager's
  existing subscriber events — archive also closes the runtime, covering plain "close") and at the
  top of `attach` (forced respawn / resume). Nothing else cancels.
- **No artificial TTL for untimed dialogs.** A questionnaire waits for a human, possibly for hours
  (`rpiv-ask-user-question` blocks indefinitely by design). Inventing a daemon-side expiry would
  cancel legitimate questions. Untimed dialogs end only by being answered or by a terminal sweep.
  Pi-supplied `timeout` is mirrored solely so the UI dismisses in step with Pi.
- **Concurrency is not serialized.** Several extensions may hold dialogs open at once; all stay
  pending and are all broadcast. Presentation order is a client concern.
- **Unknown methods are forwarded, never answered.** Broadcast with `expectsResponse: false`, logged
  once per method per session at info. Safe for every method Pi ships today: none of the current
  fire-and-forget set blocks, so a never-answered unknown method cannot hang a turn. If a future Pi
  adds a new *dialog* method, the calling extension stays blocked until the adapter's dialog-method
  constant learns the name — a one-line change; the wire offers no blocking marker, so this is the
  floor, and the info log is what makes the situation diagnosable (§ Error handling).
- **`setStatus` is the only unbounded-rate path.** Progress-style extensions can tick status many
  times a second; v1 broadcasts every update with no coalescing (payloads are small, WS fan-out is
  cheap, and retention makes any future per-key trailing-edge coalescing lossless — that is the
  sanctioned escape hatch if this proves chatty in practice, not a v1 requirement).
- **Provider opt-out is silent.** A session without `onUiRequest` (any pre-existing provider) simply
  produces no UI traffic; no capability probing, no errors.

## Data & persistence touchpoints

- **Nothing is persisted.** Pending dialogs and retained surfaces are in-memory, keyed by agent, and
  die with the daemon — correctly, since the Pi processes holding those dialogs die with it too, so
  there are no orphans to reconcile on restart.
- No changes to `$PI_STUDIO_HOME` layout, no new entity files, no timeline entries.
- Retained surfaces are bounded: last-value-wins per namespaced `surfaceKey`, deleted individually by
  the protocol's own clear forms (`removed: true`), and dropped wholesale by terminal sweeps.

## Error handling & edge cases

| Condition | Expected behavior |
|-----------|-------------------|
| Two clients answer the same dialog | First wins; second gets `{ ok:false, error:"not_found" }`; `agent_ui_resolved` already broadcast |
| Answer names an unknown/stale `uiRequestId` | `{ ok:false, error:"not_found" }`; no provider call |
| Answer targets a fire-and-forget request (`expectsResponse:false`) | `{ ok:false, error:"not_found" }` — it was never pending |
| Response body smuggles `id`/`type` keys | Harmless: envelope fields are stamped after the body spread and cannot be overridden; the rest of the body forwards verbatim |
| Two agents' providers emit the same provider-scoped request id | No interference: wire ids are daemon-minted; provider ids are per-entry private state |
| Provider lacks `respondToUi` | `{ ok:false, error:"unsupported" }` |
| Provider's `respondToUi` throws (process died mid-answer) | `{ ok:true }` to the answering client, failure logged, `agent_ui_resolved` still broadcast (try/finally) — no ghost dialogs |
| Client disconnects with a dialog pending | Dialog **stays pending**; another client (or MCP) answers it |
| Agent interrupted | **Nothing happens**: pending dialogs and surfaces untouched (see § Behavior) |
| Agent archived / deleted | Terminal sweep: every pending dialog answered `{ cancelled:true }` toward the provider best-effort, broadcast `reason:"aborted"`, pending + surfaces + channel dropped |
| Forced respawn (`resume_agent` always spawns a fresh process) | `attach` sweeps first: old pending resolved `reason:"aborted"`, surfaces dropped (extensions re-emit them on `session_start` in the new process); stale ids answer `not_found` |
| Pi process crashes with dialogs pending | Entries remain until the agent's next attach/archive/delete sweep; answering one returns `ok:true` with the write failure logged (row above) |
| Pi-supplied `timeout` elapses | Local expiry + `reason:"timeout"`; **no** `extension_ui_response` sent (Pi self-resolved) |
| Answer races Pi's own timeout | Daemon forwards it; Pi ignores a response for an already-resolved id — same harmless race as interrupt-internal aborts |
| Pi emits an unknown/future `method` | Broadcast as `expectsResponse:false`; logged once per method per session at info; never answered. A future *dialog* method blocks its extension until the adapter constant is extended (the documented floor of forward compat) |
| Malformed/nonsensical response shape | Forwarded (post-stamping); Pi resolves the dialog with `undefined`/`false` — the extension's own cancel path |
| Same `surfaceKey` updated repeatedly | Last value retained; every update still broadcast |
| One extension uses the same name as `statusKey` and `widgetKey` | Two distinct surfaces (`status:x` vs `widget:x`) — Pi's docs do exactly this (`"my-ext"`) |
| Surface cleared (`statusText`/`widgetLines` absent) | Surface deleted; `agent_ui_request` still broadcast with `removed:true` so live clients clear; absent from `agent_ui_list_response` |
| `ctx.ui.custom()` | Pi returns `undefined` inside the agent process; nothing reaches the daemon. Not representable, out of scope |
| Payload/response logging | **Never logged.** An `input` dialog can carry a secret (an extension asking for a token). Log `agentId`/`requestId`/`method` only — same rule as `provider_auth_rpc.md` |

### Dev daemon

Registered in **both** `bootstrap.ts` and `dev-bootstrap.ts`. This deviates from
`provider-auth`/`file-watch` (production-only) on purpose: the mock provider is the intended
deterministic producer for this family, the dev daemon is mock-only, and a UI family that cannot be
exercised in the dev daemon would be untestable exactly where the sibling UI scope needs to develop
against it. Follows `PermissionService.registerHandlers`' both-bootstraps precedent
(`bootstrap.ts:293-294`, `dev-bootstrap.ts:125-126`) — the closest analogue, being the other
agent-scoped broadcast family. Note that the service+`-rpc` module pairs cited above
(`provider-auth`, `file-watch`, `terminal`) are all production-only, so this is a deliberate
divergence from them, not an oversight.

## Dependencies on other specs

- `../architecture/websocket-protocol.md` — envelope, flat-name RPC convention, union vs passthrough
  push families, capability flags.
- `agent-providers.md` — provider isolation: all Pi specifics stay inside `providers/pi/`; the
  service talks only to `provider-contract.ts`.
- `agent-sessions.md` — session attach choke point (`AgentManager.attachSession`) and the
  archive/delete lifecycle that drives terminal sweeps.
- `tool-permissions.md` — adjacent, deliberately separate family (§ Relationship above).
- `preinstalled-extensions.md` — supplies the `core` pack extensions that produce this traffic and
  make the bridge observable end to end.
- `mcp-server.md` — the two mirror tools.

## Acceptance criteria

- [ ] A `select` dialog emitted by the mock provider is broadcast as `agent_ui_request` with a
      daemon-minted `requestId`, `expectsResponse:true`, and the payload intact;
      `agent_ui_respond_request` forwards the chosen value to the provider and broadcasts
      `agent_ui_resolved reason:"answered"`.
- [ ] `confirm`, `input`, and `editor` round-trip `{confirmed}` / `{value}` / `{cancelled}` verbatim.
- [ ] A fire-and-forget `notify` is broadcast with `expectsResponse:false`, is absent from
      `agent_ui_list_response.pending`, and answering it returns `{ ok:false, error:"not_found" }`.
- [ ] `setWidget`/`setStatus`/`setTitle` are retained last-value-wins per namespaced `surfaceKey`; a
      fresh `agent_ui_list_request` after several updates returns exactly one surface per key with
      the latest payload, so a reconnecting client can rebuild current state it never saw live.
- [ ] One extension emitting `statusKey:"x"` **and** `widgetKey:"x"` yields two distinct retained
      surfaces (`status:x`, `widget:x`) — neither clobbers the other.
- [ ] A clear form (`statusText`/`widgetLines` absent) deletes the surface, broadcasts
      `removed:true`, and the key is absent from a subsequent `agent_ui_list_response`.
- [ ] Two agents whose providers emit the **same provider-scoped request id** hold two independent
      pending dialogs, each answerable without touching the other (daemon-minted wire ids).
- [ ] A response body containing `id`/`type` keys cannot redirect the answer: the provider spy
      receives the entry's own provider id in the envelope regardless of body contents.
- [ ] Two concurrent answers to one dialog: first `{ok:true}`, second `{ok:false,"not_found"}`, and
      the provider receives exactly one response.
- [ ] Simulated client disconnect leaves the pending dialog intact and answerable by another session
      (explicitly asserts the divergence from `provider_auth`'s disconnect-cancels rule).
- [ ] Interrupt leaves pending dialogs **and** retained surfaces untouched.
- [ ] Archive/delete answers every pending dialog `{cancelled:true}` toward the provider, broadcasts
      `reason:"aborted"`, and leaves the pending map, surface map, and channel map empty (no leak).
- [ ] Re-attach for an agent with pending dialogs (forced respawn) resolves them `reason:"aborted"`
      first, drops surfaces, and the stale ids answer `not_found`.
- [ ] A provider whose `respondToUi` throws still yields `{ok:true}` to the answering client and a
      broadcast `agent_ui_resolved` (no ghost dialogs after a provider crash).
- [ ] A Pi-supplied `timeoutMs` expires locally with `reason:"timeout"` and sends **no**
      `extension_ui_response` (asserted on a provider spy, using fake timers).
- [ ] An untimed dialog is still pending after a long simulated idle period — no daemon-side TTL.
- [ ] An unknown `method` is broadcast as `expectsResponse:false` and never answered; a following
      known dialog still works (unknown methods don't poison the channel).
- [ ] The Pi adapter translates a real `extension_ui_request` fixture for all nine documented methods
      into the correct `expectsResponse`/namespaced `surfaceKey`/`removed`, and `respondToUi` writes
      `extension_ui_response` with envelope fields stamped after the body — asserted against a fake
      `PiRpcTransport`, no `pi` process.
- [ ] `AgentUiService` unit tests use a fake session implementing only the two contract members —
      no Pi, no child process, no network.
- [ ] No payload value appears in any log line or in any outbound frame other than the intended
      `agent_ui_request`/`agent_ui_list_response` (log-capture + outbound-frame scan, mirroring
      `provider-auth-rpc.md`'s secret-scan criterion).
- [ ] `server_info.features.extensionUi` is advertised, and `client-capabilities.test.ts`'s
      exact-sorted-key-set assertion is updated (8 → 9 keys).
- [ ] A session from a provider without `onUiRequest` produces no UI traffic and no errors; every
      spawn path (create, resume, import) attaches via the single `onSessionAttached` hook.
- [ ] MCP `list_pending_ui_requests` / `respond_to_ui_request` resolve a dialog the same way the WS
      RPC does, and report `unknown_ui_request` for a stale id.
- [ ] Live smoke test against a real `pi --mode rpc` with `@juicesharp/rpiv-ask-user-question`
      installed: the questionnaire's RPC fallback surfaces as `agent_ui_request`(s) over the socket
      and an answer sent over WS lets the tool call complete — proving the POC auto-cancel is gone in
      the real path, not just against fakes.

## Out of scope

- **Client SDK** (`packages/client`) surface — sibling UI scope.
- **Web-client** rendering, renderer registry, toasts, native todo panel — sibling UI scope.
- **CLI** mirror (`pi-studio ui …`) — separate, follows `permit`'s shape if wanted.
- **`ctx.ui.custom()`** TUI components — not representable outside a terminal; Pi returns `undefined`
  for it in RPC mode by design.
- **Mode-gated tool-call approval** (the real `tool-permissions.md` feature) — still dormant, still
  its own family.
- **Timeline persistence of UI interactions** — ephemeral by design; revisit only if a product need
  for auditing answers appears.
- **`setStatus` coalescing** — noted escape hatch, not v1 (§ Behavior).

## Open questions

- [ ] Whether any bundled `core`-pack extension emits a dialog **before** the daemon has attached its
      UI channel (e.g. from a `session_start` handler racing session construction).
      `AgentManager.attachSession` runs immediately after session creation on every path, which
      narrows the window to the provider constructor itself; if a live run with the `core` pack shows
      traffic in that window, the Pi adapter must buffer UI events until the first `onUiRequest`
      subscriber arrives (a bounded internal queue, not a contract change).
