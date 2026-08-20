# Task 002 — `agent-ui-state.ts`: pure reducer, predicate routing, effects, selectors

- **Sprint:** sprint-067-extension-ui-sdk
- **Status:** done
- **Type:** feature
- **Area:** packages/client (pure state module)
- **Priority:** P1
- **Estimated size:** M
- **Depends on:** task-001

## Goal

Add `packages/client/src/agent-ui-state.ts` — a framework-free reducer plus selectors that owns the
whole extension-UI state machine (dialog/surface/transient routing, snapshot replacement, disconnect,
agent pruning) and returns effects instead of performing them, so every hard decision in this feature
is unit-tested under Node before any component exists.

## Context / why

This module is the reason the sprint is worth shipping without UI. Everything genuinely difficult
here is state logic: routing a method Pi has not invented yet, replacing state on reconnect without
regressing a surface, and displaying a countdown that must never *act*. Solved here, the sibling UI
scope becomes component work over a tested machine.

**Routing is by wire predicate, never by a `method` table.** The client needs **three** categories
where Pi and the daemon model two, because two fire-and-forget methods are not surfaces:

```
expectsResponse        → dialog            (select, confirm, input, editor)
surfaceKey && removed  → delete surface
surfaceKey             → upsert surface    (setStatus, setWidget, setTitle)
otherwise              → transient effect  (notify, set_editor_text)
```

A flat `method → handler` map cannot express `set_editor_text` (mutates a composer, renders nothing)
and gives no safe default for unknown methods. The daemon already makes the third row free: no
`surfaceKey` means nothing is retained, so `agent_ui_list` can never feed a reconnecting client a
stale toast.

**Unknown methods, asymmetrically.** An unknown *dialog* (`expectsResponse: true`, unrecognised
`method`) **still enters `pending`** with `method` stored verbatim — dropping it wedges the agent's
turn until Pi's timeout for a method the daemon forwards correctly. An unknown *fire-and-forget*
method is ignored. Note there is **no** `unknown`/`fallback` flag on the entry: that would require a
known-methods table, which the routing rule above forbids. "Unknown" is a render-time fact (the UI
scope's registry lookup misses) and, for logging, the signal is **a transient that produced zero
effects** — see the `reduce` contract below. That keeps the only `method`-keyed code in the module
confined to *effect construction within* the transient category, which is exactly what the scope
permits (`method` matters only *within* a category).

**Snapshot replaces; it does not merge.** The WebSocket is a single ordered stream and the daemon
composes `agent_ui_list_response` from state that postdates every broadcast already sent on that
socket. So the snapshot is authoritative: `pending` and `surfaces` are replaced wholesale and
`answerable` is reset to `true` on every entry. Surfaces are last-write-wins on
`(agentId, surfaceKey)` and are **not** deduped by `requestId` (each upsert carries a fresh id), so
merging an older event in after a snapshot would silently roll a widget back until the extension's
next update.

**`answerable` must round-trip.** `disconnected` sets it `false`; only a snapshot sets it back
`true`. Miss that and the first network blip permanently disables every dialog — a one-way door.

**Timeouts are displayed, never acted on.** Pi's own docs state the agent auto-resolves on timeout and
*"the client does not need to track timeouts."* Two clients running independent expiry logic would
diverge from each other and from the agent. So `remainingMs` is a pure function of `(entry, now)` and
**no** action or code path in this module dismisses an entry on expiry — only `ui_resolved` removes a
dialog.

**Agent pruning is client-side by necessity.** On archive/delete the daemon broadcasts
`agent_ui_resolved` per pending dialog but sweeps surfaces with a bare `surfaces.delete(agentId)` and
**no broadcast** (`packages/server/src/agent/agent-ui/agent-ui-service.ts`, sweep path). A connected
client that never re-snapshots would keep an archived agent's status strip and widgets forever. Hence
the `agent_removed` action.

## Scope references

- `swe/features/extension-ui-client-sdk.md` § Pure state module, § Routing taxonomy,
  § Rehydration, § Timeout display, § Unknown methods, § Transient effects, § Disconnect,
  § Agent lifecycle
- `packages/client/src/pistudio-client.ts` — `AgentUiEventMeta`, `AgentUiRespondResult` (task-001)
- `packages/protocol/src/messages.ts` — `agentUiRequestSchema` / `agentUiResolvedSchema` /
  `agentUiPendingRequestSchema` / `agentUiSurfaceSchema` field sets; `wireTimestampSchema`
  (line ~22, `z.union([z.number(), isoTimestampSchema])`) — `createdAt` is **number or ISO string**
- `packages/server/src/agent/agent-ui/agent-ui-service.ts` — the authority this mirrors: surface
  keying, clear-by-omission → `removed`, and the silent surface sweep
- `packages/client/src/terminal-stream-router.ts` — precedent for a small pure module in this package

## What to build

Create `packages/client/src/agent-ui-state.ts`. No framework, no DOM, **no timers, no I/O, no
logging**. All state transitions return new objects; never mutate an input.

```ts
export interface AgentUiPendingEntry {
  requestId: string; agentId: string; method: string;
  payload: Record<string, unknown>;
  timeoutMs?: number;
  createdAt: number | string;   // as received; normalised only inside remainingMs
  receivedAt?: number;          // local clock, live events only (absent for snapshot-recovered)
  answerable: boolean;
}
export interface AgentUiSurfaceEntry {
  agentId: string; surfaceKey: string; method: string;
  payload: Record<string, unknown>; updatedAt: number | string;
}
export interface AgentUiState {
  pending: Record<string, AgentUiPendingEntry>;          // keyed by requestId (daemon-minted, global)
  surfaces: Record<string, AgentUiSurfaceEntry>;         // keyed by surfaceMapKey(agentId, surfaceKey)
}
export type AgentUiAction =
  | { type: "ui_request"; event: AgentUiRequest; meta: AgentUiEventMeta }
  | { type: "ui_resolved"; event: AgentUiResolved }
  | { type: "snapshot"; pending: AgentUiPendingRequest[]; surfaces: AgentUiSurface[] }
  | { type: "disconnected" }
  | { type: "agent_removed"; agentId: string };
export type AgentUiEffect =
  | { type: "replace_composer_text"; agentId: string; text: string }
  | { type: "notify"; agentId: string; message: string; level: string };

export const initialAgentUiState: AgentUiState;
export function reduce(state: AgentUiState, action: AgentUiAction):
  { state: AgentUiState; effects: AgentUiEffect[] };
export function surfaceMapKey(agentId: string, surfaceKey: string): string;
```

Action semantics:

- **`ui_request`** — classify by the predicate ladder above.
  - dialog → upsert into `pending` with `answerable: true`, `receivedAt: meta.receivedAt`,
    `method` verbatim, no unknown-flag.
  - surface + `removed` → delete `surfaceMapKey(...)`; a key never seen is a **no-op, not an error**.
  - surface → upsert (last-write-wins).
  - transient → no state change; build effects by `method`: `set_editor_text` → exactly one
    `replace_composer_text` (**always replace** — matches Pi's own semantics, where `pasteToEditor`
    delegates to `setEditorText` with no paste handling, and is predictable for extension authors);
    `notify` → one `notify` with `level` **forwarded verbatim** (`info`/`warning`/`error`, not
    collapsed onto today's `ToastVariant`, which has no `warning`); **anything else → zero effects**,
    which is the caller's "unknown fire-and-forget" signal.
- **`ui_resolved`** — delete `pending[requestId]`. An unknown id is a plain no-op (no throw, no
  state change): ordered delivery makes a resolved-before-its-snapshot-twin unconstructible, so no
  tombstone bookkeeping exists.
- **`snapshot`** — replace `pending` and `surfaces` **wholesale** from the arrays; every rebuilt
  entry gets `answerable: true` and **no** `receivedAt` (it is not a local observation).
- **`disconnected`** — set `answerable: false` on every pending entry; clear nothing.
- **`agent_removed`** — drop every surface for that `agentId`, and (defensively) every pending entry
  for it too.

Selectors, all pure:

- `pendingForAgent(state, agentId): AgentUiPendingEntry[]` — stable order (ascending `createdAt`,
  `requestId` as tie-break) so a list cannot jitter between renders.
- `pendingByAgent(state): Record<string, number>` — the attention-badge derivation, so badging is a
  subscription rather than UI logic. Agents with zero pending must be **absent**, not `0`.
- `surfacesForAgent(state, agentId): AgentUiSurfaceEntry[]` — same stability requirement.
- `remainingMs(entry, now): number | null` — `null` when `timeoutMs` is absent (untimed dialogs wait
  for a human, possibly hours). Anchor on `receivedAt` when present; otherwise normalise `createdAt`
  (accept **both** epoch ms and ISO string) and accept the residual cross-host clock skew. Clamp at
  `0`; never return negative. Add a comment stating the skew is accepted and why this is a legibility
  affordance, not a control.

## Out of scope

- All wiring: subscriptions, `listAgentUi` calls, reconnect, queueing (task-003).
- Deciding *which* queued events survive a snapshot — the reducer applies whatever it is handed;
  the discard/apply policy is the controller's (task-003).
- Logging. The reducer stays pure; the controller owns the "zero effects from a transient" log.
- Any rendering, any toast-variant change, any `setTitle` → session-title promotion (explicitly
  dropped in the scope's § Out of scope).
- Dismissing anything on timeout — prohibited, not deferred.

## Acceptance criteria

- [ ] All nine documented Pi methods (`select`, `confirm`, `input`, `editor`, `setStatus`,
      `setWidget`, `setTitle`, `notify`, `set_editor_text`) land in the correct category, asserted
      per method, driven **only** by the wire predicates — no method list in the routing path.
- [ ] An unknown **dialog** method enters `pending` with `method` verbatim and no unknown/fallback
      flag on the entry; an unknown **fire-and-forget** method changes no state and returns **zero**
      effects.
- [ ] Two different agents may hold the **same** `surfaceKey` simultaneously without collision
      (composite keying), and an upsert to one leaves the other untouched.
- [ ] `removed: true` for a `surfaceKey` never seen is a no-op; upsert-then-clear leaves no surface.
- [ ] A later surface upsert replaces an earlier one for the same `(agentId, surfaceKey)` even though
      its `requestId` differs (last-write-wins, not `requestId`-deduped).
- [ ] `ui_resolved` for an unknown `requestId` returns the state unchanged and does not throw.
- [ ] `snapshot` **replaces**: an entry present in state but absent from the snapshot is gone
      afterwards; a surface whose snapshot payload is older than a pre-existing one still wins.
- [ ] `disconnected` → `answerable: false` on all pending, nothing removed; a following `snapshot`
      restores `answerable: true` (the round-trip, asserted explicitly so the one-way door cannot
      regress).
- [ ] `agent_removed` drops that agent's surfaces **and** pending entries, leaving other agents'
      state untouched.
- [ ] `set_editor_text` produces exactly one `replace_composer_text` carrying `{ agentId, text }`;
      `notify` with `level: "warning"` forwards `"warning"` verbatim.
- [ ] `remainingMs` returns `null` without `timeoutMs`; anchors on `receivedAt` when present; accepts
      a snapshot entry's `createdAt` as **both** epoch ms and ISO string; clamps at `0`.
- [ ] No exported function dismisses, expires or mutates an entry on timeout (grep-level assertion in
      the test's comment plus a test that advances `now` far past `timeoutMs` and shows the entry
      still present and `answerable`).
- [ ] `pendingByAgent` omits agents with zero pending dialogs.
- [ ] Every reducer call leaves its input `state` object untouched (referential-integrity assertion).
- [ ] Tests run under Node with **no jsdom**.

## Test / verification plan

- Build: `npm run build:client` succeeds.
- Typecheck: `npm run typecheck` succeeds.
- Lint/format: `npx oxlint packages/client/src/agent-ui-state.ts` and `npx oxfmt --check` on the two
  new files, clean.
- Tests: create `packages/client/src/agent-ui-state.test.ts` covering every criterion above. Run
  `npx vitest run packages/client/src/agent-ui-state.test.ts`; all pass.

## Notes

- `surfaceMapKey` must be unambiguous: prefix with `agentId` (a UUID, so pick a separator no UUID
  contains, e.g. `\u0000`) and store `agentId`/`surfaceKey` **on the entry** so nothing ever parses
  the key back apart.
- Sprint-066 namespaces surface keys **by method** in the Pi adapter (Pi's own docs reuse the same
  key for `statusKey` and `widgetKey`, so un-namespaced a status tick deletes its own widget). The
  client therefore receives already-namespaced keys and must **not** re-namespace them.
- `payload` stays opaque: never inspect it except to read `text`/`message`/`level` for the two
  transient effects, and even then defensively (a missing field must not throw).
- `reason` on `ui_resolved` is an open string — never switch on it exhaustively.
