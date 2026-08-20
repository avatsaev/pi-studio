# Task 005 — `agent-ui-state.ts`: retain resolved dialogs, in-flight submission tracking

- **Sprint:** sprint-067-extension-ui-sdk
- **Status:** done
- **Type:** feature
- **Area:** packages/client (pure state module + controller wiring)
- **Priority:** P1
- **Estimated size:** M
- **Depends on:** task-002, task-003

## Goal

Give `agent-ui-state.ts` a `resolved` slice and `agent-ui-controller.ts` in-flight submission
tracking, so a resolved dialog collapses in place and stays for the life of the page, and a pressed
control can show a spinner while its answer is in transit — without the web-client reimplementing
any of that as a second, untested pending→resolved machine of its own.

## Context / why

`swe/UI design/redesign 0.1.0/Extension Dialogs Visual Spec(1).html` (rev 2 §04/§05/§06) requires a
resolved dialog to:

- collapse in place and show its outcome, for the life of the page;
- keep its position in the merged pending+resolved list — the list must never reshuffle when one
  resolves;
- show an in-flight spinner on the pressed control while a response is in transit.

`agent-ui-state.ts` currently has no state for any of this: `reduceUiResolved` (lines 186-193)
deletes the entry outright on resolution, and nothing records that this client has submitted an
answer. Leaving it there forces the web-client to maintain a parallel pending→resolved machine in a
component — untestable in this repo (no jsdom), and it would duplicate the one thing this module
exists to own (`swe/features/extension-ui-client-sdk.md`'s framing: "everything genuinely hard here
is state, not pixels").

Everything below stays inside the module's existing contract: pure, no DOM, no timers, no I/O, no
clocks, effects returned never performed.

## Scope references

- `swe/UI design/redesign 0.1.0/Extension Dialogs Visual Spec(1).html` rev 2 §04 (resolved-card
  requirements, secret-echo prohibition), §05 (in-flight spinner), §06 (stable list ordering)
- `swe/features/extension-ui-client-sdk.md` § Pure state module — its action/state/selector lists
  predate this task and are updated by it (see § Docs below)
- `packages/client/src/agent-ui-state.ts` — `AgentUiPendingEntry` (lines 40-51), `AgentUiState`
  (lines 61-66), `initialAgentUiState` (line 68), `AgentUiAction`/`AgentUiEffect` (lines 72-81),
  `reduce` (lines 99-115), `reduceUiRequest` (lines 117-163), `reduceUiResolved` (lines 186-193),
  `buildSnapshotState` (lines 195-226), `markAllUnanswerable` (lines 228-235), `dropAgent`
  (lines 237-247), `compareByTimeThenId` (lines 251-259), `pendingForAgent` (lines 261-267)
- `packages/client/src/agent-ui-controller.ts` — `respond` (line 181, currently a bare pass-through
  `(uiRequestId, response) => client.respondToUi(uiRequestId, response)`), `commit` (lines 81-93)
- `@av-pi-studio/protocol` — `AgentUiResponse` (already exported; re-exported by
  `packages/client/src/pistudio-client.ts`)

## What to build

### 1. State additions (`agent-ui-state.ts`)

```ts
/** A dialog that is no longer answerable, kept for display only. Page-lifetime state: it survives
 *  a reconnect (the daemon has no resolved history to re-serve) and dies with the tab. */
export interface AgentUiResolvedEntry {
  requestId: string;
  agentId: string;
  method: string;
  payload: Record<string, unknown>;
  /** The ORIGINAL createdAt, so a card keeps its slot in a merged list when it resolves. */
  createdAt: number | string;
  /** Verbatim from `agent_ui_resolved` — an open string, never relabeled, never enumerated. */
  reason: string;
  /** Present only when THIS client answered a `select`/`confirm`. See § 3. */
  answer?: { value?: string; confirmed?: boolean };
}
```

Add to `AgentUiState`:

```ts
/** Keyed by `requestId`, same as `pending`. Bounded per agent — see RESOLVED_HISTORY_LIMIT. */
resolved: Record<string, AgentUiResolvedEntry>;
```

Update `initialAgentUiState` to `{ pending: {}, surfaces: {}, resolved: {} }`.

Add to `AgentUiPendingEntry`:

```ts
/** A respond from this client is in flight. Never an optimistic resolution — the entry stays
 *  pending until a real `ui_resolved` arrives. */
submitting?: boolean;
/** What this client submitted, for `select`/`confirm` only. See § 3. */
submittedAnswer?: { value?: string; confirmed?: boolean };
```

Deliberately **not** carried onto the resolved entry: `answerable`, `receivedAt`, `timeoutMs`,
`submitting`. A resolved card has no deadline bar and no countdown, so leaving `timeoutMs` off makes
`remainingMs` structurally inapplicable to it rather than merely discouraged.

### 2. New actions

```ts
| { type: "respond_sent"; requestId: string; response: AgentUiResponse }
| { type: "respond_failed"; requestId: string }
```

### 3. The one rule that is a safety property, not a preference

`submittedAnswer` / `answer` are populated only when `entry.method` is `select` or `confirm`, and
**never** for `input`, `editor`, or an unknown method.

`input` and `editor` resolve to free text the user typed, and an extension asking for an API token
is an expected case (`extension-ui-rpc.md`'s logging rule exists for exactly this). Rev 2 §04
forbids echoing those values — "no value, no length, no truncated prefix, no reveal affordance".
Enforcing it here means the secret is unrepresentable in client state, so no future component can
render it by accident. Enforcing it in the UI instead would make it a convention one careless
`JSON.stringify` breaks.

This is the only place `method` is inspected outside the transient category (`buildTransientEffects`,
lines 165-184, is the existing one). Document it in the module header (lines 10-36) alongside the
existing "routing is by wire predicate, never by a method table" note, since it is a deliberate,
narrow exception — it is a **storage** rule, not routing.

### 4. Transitions

| Action | Behaviour |
|---|---|
| `ui_resolved`, known id | Move pending → resolved: copy `requestId`/`agentId`/`method`/`payload`/`createdAt`, set `reason: event.reason`, and set `answer` from the entry's `submittedAnswer` if present. Delete from `pending`. Then apply the § 5 cap. |
| `ui_resolved`, unknown id | Still a plain no-op, exactly as today (lines 187-189). Do not synthesise a resolved entry: the broadcast carries no `method`/`payload`, so there is nothing renderable, and the existing comment about ordered delivery still holds. |
| `respond_sent`, known id | Set `submitting: true`; set `submittedAnswer` per § 3. Entry stays in `pending` — no removal, no resolution, no effects. |
| `respond_sent`, unknown id | No-op. |
| `respond_failed` | Clear `submitting` and `submittedAnswer` if the entry is still pending; no-op otherwise. This is what stops a lost first-answer-wins race from leaving a spinner running forever, since a `not_found` response is followed by no broadcast to this client. |
| `snapshot` | `resolved` passes through untouched. The snapshot is authoritative for `pending` and `surfaces` only; `agent_ui_list_response` has no resolved history, so replacing it wholesale would wipe the collapsed cards on every reconnect. `buildSnapshotState` (lines 195-226) currently returns a fresh object with no third field — thread the existing `resolved` through it as a parameter (and update its comment at lines 199-202, which currently says the replacement is wholesale for the whole state). Rebuilt pending entries carry no `submitting` — correct, a dropped socket invalidates any in-flight respond. |
| `disconnected` | `resolved` untouched. `markAllUnanswerable` (lines 228-235) keeps its current behaviour. |
| `agent_removed` | Drop that agent's resolved entries too, alongside pending and surfaces (`dropAgent`, lines 237-247). |

### 5. Bounding

```ts
/** Per-agent cap on retained resolved dialogs. Page-lifetime state, but a chatty extension over a
 *  long session must not grow it without limit. */
export const RESOLVED_HISTORY_LIMIT = 50;
```

On insert, if that agent's resolved count exceeds the limit, evict the oldest by `createdAt` with a
`requestId` tie-break — reuse the existing `compareByTimeThenId` helper (lines 251-259) rather than
a second comparator.

### 6. Selector

```ts
/** Every resolved dialog for one agent, oldest first (`createdAt`, `requestId` tie-break). */
export function resolvedForAgent(state: AgentUiState, agentId: string): AgentUiResolvedEntry[]
```

Same comparator and shape as `pendingForAgent` (lines 261-267). The ordering key must be the
original `createdAt`, because the UI merges this with `pendingForAgent` into one list and rev 2 §06
requires that "the list never reshuffles when one resolves".

No clocks, and no `resolvedAt` field. §06 forbids per-card timestamps, and ordering and eviction
both key off the original `createdAt`, so the module stays clock-free and every existing function
signature (`reduce`, the selectors) is unchanged in arity.

### 7. Controller (`agent-ui-controller.ts`)

`respond` (line 181) is currently a pass-through:
`respond: (uiRequestId, response) => client.respondToUi(uiRequestId, response)`.

It becomes: dispatch `respond_sent`, `await client.respondToUi`, dispatch `respond_failed` when the
result is `ok === false`, and return the result unchanged. Never throw on a domain outcome —
`AgentUiRespondResult` stays the contract (task-001's error-convention split is unaffected). Respect
the existing `disposed` guard the other paths use (`commit`, lines 81-82).

## Out of scope

- No optimistic dismissal, no exception for "we're sure it succeeded".
- No tombstones for unknown ids.
- No copy strings — "answered", "submitted", "Yes/No" are the UI's, not this module's. `reason` is
  forwarded verbatim.
- No changes to `surfaces`, the protocol package, the wire, or the daemon.
- No rendering, no React, no new dependency.
- Cross-package E2E against a real daemon or real Pi (task-004 already covers the wire contract this
  builds on; this task's tests are all against the pure reducer / scripted controller harness).

## Acceptance criteria

- [ ] `ui_resolved` moves an entry to `resolved`, preserving `createdAt`, `method`, `agentId`,
      `payload`, and forwarding `reason` verbatim.
- [ ] The resolved entry has no `timeoutMs`, `receivedAt`, `answerable`, or `submitting`.
- [ ] `resolved` survives `snapshot` and `disconnected`; `agent_removed` drops that agent's resolved
      entries and leaves other agents' untouched.
- [ ] `ui_resolved` for an unknown id remains a no-op — no synthesised entry, no throw.
- [ ] `respond_sent` leaves the entry in `pending` with `submitting: true` and emits no effects.
- [ ] `submittedAnswer`/`answer` are set for `select` and `confirm` and absent for `input` and
      `editor` — assert the typed value never appears anywhere in the resulting state (a
      `JSON.stringify(state)` scan for the submitted string is the honest form of this test).
- [ ] `respond_failed` clears `submitting`, so a lost first-answer-wins race cannot leave a permanent
      in-flight state.
- [ ] Cap eviction: past `RESOLVED_HISTORY_LIMIT` for one agent, the oldest `createdAt` is evicted
      and other agents' resolved entries are untouched.
- [ ] `resolvedForAgent` ordering matches `pendingForAgent`'s comparator, and merging both by
      `createdAt` keeps an entry's index stable across resolution (assert the same array index
      before and after resolving one entry from the middle of a mixed list).
- [ ] Controller: a `respond` returning `{ ok: false }` dispatches `respond_failed` and still returns
      the result rather than throwing; a `respond` that resolves `{ ok: true }` leaves `submitting`
      alone (cleared only by the subsequent `ui_resolved`, never by the RPC's own success).
- [ ] `dispose()` still tears down cleanly with the new state shape present (regression check on the
      existing controller test suite).

## Test / verification plan

- Build: `npm run build:client` succeeds.
- Typecheck: `npm run typecheck` (use `--force` or `npm run clean` first — incremental
  `.tsbuildinfo` has hidden signature errors here before, per this package's own precedent).
- Lint/format: `npx oxlint packages/client/src/agent-ui-state.ts packages/client/src/agent-ui-controller.ts`
  and `npx oxfmt --check` on the changed files, clean.
- Tests: extend `packages/client/src/agent-ui-state.test.ts` with the reducer/selector criteria
  above, and `packages/client/src/agent-ui-controller.test.ts` with the `respond_sent`/
  `respond_failed` wiring criteria, against the existing `makeScriptedDaemon` harness. Run
  `npx vitest run packages/client/src/agent-ui-state.test.ts packages/client/src/agent-ui-controller.test.ts packages/client/src/pistudio-client.test.ts`;
  all pass.
- Full sprint gates before marking done: `npm run build`, `npm run typecheck`, `npm run lint`,
  `npm test`.

## Notes

- `agent-ui-state.ts`'s module header (lines 10-36) documents the module's invariants; add the § 3
  storage-rule exception there rather than only in a function-local comment, since it is the kind of
  rule a future reviewer needs to see before writing a sixth action type.
- `RESOLVED_HISTORY_LIMIT` is a plain exported constant, not a controller option — the reducer stays
  the single source of truth for how much history it retains, matching how `AgentUiState`'s other
  bounds (there are none today) would be specified if any existed.
- Docs sync (same change, per the repo rule): update `packages/client/AGENTS.md` (the `resolved`
  slice, the two new actions, `RESOLVED_HISTORY_LIMIT`, `resolvedForAgent`, the select/confirm-only
  answer rule and why it is a storage rule, and the lifetime property — "survives a reconnect, dies
  with the page") and `swe/features/extension-ui-client-sdk.md` § Pure state module (its action/
  state/selector lists predate this task; add the additions and a line stating that resolved
  retention exists because the daemon has no resolved history to re-serve).
