# Task 001 — `PiStudioClient` extension-UI surface: two subscriptions, two RPCs, `AgentUiError`

- **Sprint:** sprint-067-extension-ui-sdk
- **Status:** done
- **Type:** feature
- **Area:** packages/client (SDK facade)
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** none

## Goal

Give `PiStudioClient` the five members that make sprint-066's `agent_ui_*` family reachable at all —
two broadcast subscriptions, two RPCs, one capability check — plus the two type guards and the
`AgentUiError` class, so tasks 002-004 have a typed surface to build on.

## Context / why

Sprint-066 shipped the entire daemon side and **nothing consumes it**: `packages/client` has no
`agent_ui` surface, so a real extension dialog is received, retained and broadcast by the daemon to
zero listeners while the agent's turn blocks until Pi's own timeout. Sprint-066/task-006 verified
this live — every dialog across five real Pi turns sat `status: "running"`, minutes at a time,
until a hand-driven `ws` client answered it. This task is the first half of the listener.

**The error convention splits, deliberately, and this is the task that encodes it.** Both responses
carry `ok`/`error` **inside `payload`**, so a caller that only catches `RpcError` reads failure as
success — the exact hazard `provider-auth-rpc.md` warned about and `ProviderAuthError`
(`pistudio-client.ts:313`) exists for. This scope diverges on one of the two:

- `listAgentUi` **throws** `AgentUiError` — a failed snapshot is genuinely exceptional.
- `respondToUi` **returns** `AgentUiRespondResult` — `error: "not_found"` is what a client sees when
  another client answered first, i.e. the *normal* outcome of a broadcast model in multi-client
  operation. Throwing would put a routine race in the exception path and force `try`/`catch` around
  the happy path; returning a discriminated union makes the outcome impossible to ignore without a
  type error, which is the property `ProviderAuthError` was reaching for.

**Do not relabel the daemon's reason string.** The daemon returns `not_found` for an
answered-elsewhere dialog, a bogus id, **and** an already-swept agent alike (`agent-ui-rpc.ts`). A
client that renames it `already_resolved` asserts knowledge it does not have. Forward it verbatim and
type it open (`"not_found" | "unsupported" | string`).

**`AgentUiEventMeta` is deliberately *not* shaped like `AgentStreamEventMeta`.** That one carries the
daemon's `timestamp`/`seq` (`pistudio-client.ts:49-53`); this one carries `receivedAt: number`, a
**local** clock reading, because the whole point (task-002 § timeout display) is that the daemon may
run on another host and its `createdAt` is skewed. Copying the stream meta shape here would bake the
skew in silently.

## Scope references

- `swe/features/extension-ui-client-sdk.md` § Public contract (SDK surface table + the two `ts`
  blocks), § Capability gating, § Error convention
- `swe/features/extension-ui-rpc.md` § Public contract (the wire shapes being consumed)
- `packages/client/src/pistudio-client.ts` — `AgentStreamEventMeta` (line 49) as the meta precedent,
  `isProviderAuthFlowEvent` (line 231) as the guard precedent, `ProviderAuthError` (line 313),
  `onAgentUpdate` (line 418) as the subscription precedent, `hasProviderAuthCapability` (line 438),
  `listProviderAuth` (line 443) as the throw-on-`!ok` precedent
- `packages/client/src/daemon-client.ts` — `hasFeature` (line 134), `request`, `onSessionMessage`
- `packages/client/src/pistudio-client.test.ts` — `makeScriptedDaemon` (line 12): the established
  fake-transport harness, with `features`, `push` and `drop` already built in
- `packages/protocol/src/messages.ts` — `agentUiRequestSchema`, `agentUiResolvedSchema`,
  `agentUiPendingRequestSchema`, `agentUiSurfaceSchema`, `agentUiResponseSchema` (sprint-066/task-001)

## What to build

Modify `packages/client/src/pistudio-client.ts` only. Types first:

```ts
/** Local-clock anchor. The daemon may run on another host — see the scope's § Timeout display. */
export interface AgentUiEventMeta { receivedAt: number }

export type AgentUiRespondResult =
  | { ok: true }
  | { ok: false; reason: "not_found" | "unsupported" | string };

export class AgentUiError extends Error { /* name = "AgentUiError"; readonly operation: "list" */ }
```

**Four** guards, modelled on `isProviderAuthFlowEvent` (structural checks, no `zod` at runtime):
`isAgentUiRequest(message): message is AgentUiRequest` (`type === "agent_ui_request"` plus
`typeof requestId === "string"` and `typeof agentId === "string"`), and `isAgentUiResolved`
likewise. Plus two for the lifecycle messages task-003 prunes on: `isAgentArchived`
(`type === "agent_archived"`, `typeof agentId === "string"`) and `isAgentDeleted`
(`type === "agent_deleted"`, same). All four exported.

The last two are **not** part of the `agent_ui_*` family and deserve a word, because their asymmetry
with the two subscriptions above is deliberate. Archive/delete arrive as `agent_archived` /
`agent_deleted` — real `sessionMessageSchema` union members (`messages.ts`'s `agentArchivedSchema`
line 214 / `agentDeletedSchema` line 209) that the daemon fans out to every session — and
**not** as `agent_update`: `AgentManager.archiveAgent` (line 246) and `deleteAgent` (line 299) call
`broadcastArchived`/`broadcastDeleted` exclusively and never the `agent_update`-emitting
`broadcast(record)` path (whose only two call sites are lines 149 and 212). So `onAgentUpdate` —
which filters `type === "agent_update"` — can never see an archive. This task ships only the guards;
task-003 consumes them via `client.connection.onSessionMessage`. Add **no** `onAgentArchived` /
`onAgentDeleted` facade subscription: these are pre-existing lifecycle events this scope merely
observes, not part of the family it owns, and adding facade methods for them invites the same for
`agent_status`/`agent_list` next.

Five members on `PiStudioClient`:

- `onAgentUiRequest(handler: (event, meta: AgentUiEventMeta) => void): () => void` — wraps
  `daemon.onSessionMessage`, filters with the guard, stamps `meta = { receivedAt: Date.now() }`.
- `onAgentUiResolved(handler: (event) => void): () => void` — same, no meta.
- `respondToUi(uiRequestId: string, response: AgentUiResponse): Promise<AgentUiRespondResult>` —
  `daemon.request("agent_ui_respond_request", { uiRequestId, response })`; returns `{ ok: true }` or
  `{ ok: false, reason: payload.error ?? "unknown" }`. **Never throws on `payload.ok === false`.**
  A transport-level `RpcError` still propagates — that is not a domain outcome.
- `listAgentUi(agentId?: string): Promise<{ pending: AgentUiPendingRequest[]; surfaces: AgentUiSurface[] }>`
  — `daemon.request("agent_ui_list_request", agentId ? { agentId } : {})`; throws
  `AgentUiError(payload.error ?? "failed to list extension UI state", "list")` on `!payload.ok`;
  returns `{ pending: payload.pending ?? [], surfaces: payload.surfaces ?? [] }`.
- `extensionUiAvailable(): boolean` — `this.daemon.hasFeature("extensionUi")`.

`agentId` is deliberately **not** a parameter of `respondToUi`: the wire keys responses on the
daemon-minted `uiRequestId` alone. Add no `agent(id).respondToUi(...)` handle method —
`listAgentUi(agentId?)` already covers the per-agent case with one method instead of two.

No `packages/client/src/index.ts` change is required: it already does
`export * from "./pistudio-client.js"`, so every new export flows out automatically. Verify this
rather than assuming it.

## Out of scope

- The reducer, selectors and effects (task-002) and the controller (task-003).
- Any rehydration/reconnect/queueing logic — this task adds *primitives only*, no orchestration.
- Any protocol change. Sprint-066's wire contract is consumed exactly as shipped.
- Any UI, and any cross-package E2E (task-004).
- Naming this `supportsExtensionUi()` — that name is already taken by the **provider** capability
  flag (`protocol/src/provider-manifest.ts`) with different meaning; see the scope's § Capability
  gating.

## Acceptance criteria

- [ ] All five members exist on `PiStudioClient`; `AgentUiEventMeta`, `AgentUiRespondResult`,
      `AgentUiError`, `isAgentUiRequest`, `isAgentUiResolved`, `isAgentArchived`, `isAgentDeleted`
      are exported and reachable from
      `@av-pi-studio/client`'s root export.
- [ ] `respondToUi` resolves `{ ok: false, reason: "not_found" }` — **without throwing** — when the
      daemon replies `{ ok: false, error: "not_found" }`.
- [ ] `respondToUi` forwards an *undocumented* error string verbatim (open-string rule) rather than
      mapping it to a known member or to `"unknown"`.
- [ ] `respondToUi` resolves `{ ok: true }` on `{ ok: true }`, and still rejects when the transport
      raises `RpcError` (domain vs. transport failure stay distinguishable).
- [ ] `listAgentUi()` throws `AgentUiError` on `payload.ok === false`, and the error carries the
      daemon's message.
- [ ] `listAgentUi("agent-1")` sends `agentId` in the request; `listAgentUi()` omits the key entirely.
- [ ] `onAgentUiRequest` fires once per matching push with `meta.receivedAt` a finite local
      timestamp, ignores non-matching session messages, and stops firing after its unsubscribe thunk.
- [ ] `extensionUiAvailable()` is `true` only when the handshake advertised
      `features.extensionUi` truthy (assert both directions).
- [ ] All four guards reject a same-`type` message missing `requestId`/`agentId`.
- [ ] `isAgentArchived` accepts `{ type: "agent_archived", agentId, archivedAt }` **and** the same
      message with `archivedAt` absent (the protocol marks it optional); `isAgentDeleted` accepts
      `{ type: "agent_deleted", agentId }`. Neither accepts the other's `type`, and neither accepts
      an `agent_update` message — the mis-wiring this guard pair exists to make impossible.

## Test / verification plan

- Build: `npm run build:client` succeeds.
- Typecheck: `npm run typecheck` succeeds.
- Lint/format: `npx oxlint packages/client/src/pistudio-client.ts` and
  `npx oxfmt --check packages/client/src/pistudio-client.ts` clean.
- Tests: extend `packages/client/src/pistudio-client.test.ts` using the existing
  `makeScriptedDaemon` harness — add `extensionUi` to its injected `features` for the gated cases,
  and use its `push` to deliver broadcasts. Run
  `npx vitest run packages/client/src/pistudio-client.test.ts`; all pass.

## Notes

- `makeScriptedDaemon`'s `respond()` switch needs new arms for `agent_ui_respond_request` and
  `agent_ui_list_request`; keep the existing `features` default (`providersSnapshot`,
  `providerAuth`) intact so no existing test's capability assumptions shift.
- Reuse the existing `wireTimestampSchema`-typed fields as they arrive on the wire (epoch ms **or**
  ISO string). Do **not** normalise `createdAt` here — task-002 owns that, next to the skew note
  that explains it.
- `agent_ui_respond_request` carries two ids on the wire (`requestId` = RPC correlation, stamped by
  `daemon.request`; `uiRequestId` = the dialog). Do not collapse them.
