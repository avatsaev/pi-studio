# Task 003 — `agent-ui-controller.ts`: subscribe-then-list, automatic reconnect resync, agent pruning

- **Sprint:** sprint-067-extension-ui-sdk
- **Status:** done
- **Type:** feature
- **Area:** packages/client (wiring layer)
- **Priority:** P1
- **Estimated size:** M
- **Depends on:** task-001, task-002

## Goal

Add `packages/client/src/agent-ui-controller.ts` — the impure layer that drives task-002's reducer
from task-001's SDK, owning the three things a consumer would otherwise get wrong: subscribe-then-list
rehydration ordering, automatic re-sync on reconnect, and `agent_removed` pruning on archive/delete.

## Context / why

The module's entire justification is that **no consumer can get the ordering wrong**. Every client
that ships (web now; mobile/desktop later) would otherwise reimplement the same sequence, and one of
them would get it subtly wrong in a way that only shows up after a network blip in the field.

**Rehydration is subscribe-then-list, and the merge is "replace, discard, apply".** Dialogs survive a
client disconnect by design (a tab reload must not kill the agent's turn — sprint-066 verified this
against real Pi, where a brand-new connection found two still-pending real dialogs and answered
both), so a reconnecting client must recover them:

1. Attach the `agent_ui_request` / `agent_ui_resolved` handlers **first**, queueing events.
2. Call `listAgentUi()` — no `agentId`; one call covers every agent.
3. On the snapshot: dispatch `snapshot` (replaces `pending`/`surfaces`, resets `answerable`),
   **discard** queued dialog and surface events, **dispatch** queued *transient* events, then apply
   everything live.

Attach-first matters because an event delivered just after the response frame must not be dropped.
The discard/apply split follows from ordered delivery: the socket is one ordered stream and the
daemon composes the snapshot from state that postdates every broadcast already sent on it, so every
queued dialog/surface event is **already reflected in the snapshot** — replaying it can only regress
state (an older surface upsert would roll a widget back) or no-op. Queued **transients** are in no
snapshot (nothing retains them) and arrived on this connection, so they are genuinely new: apply
them, exactly once.

**Reconnect detection belongs here, not to the consumer.** Task-002's `disconnected` marks surviving
dialogs `answerable: false` and only a snapshot re-enables them, so a consumer that forgot to call
`resync()` would ship permanently dead dialogs that fail silently. The controller therefore subscribes
to connection-state transitions itself. `resync()` stays public as an escape hatch but is never
required. Transport coupling is not a cost here — the controller already takes `client` as its
dependency and is the impure layer by design; purity lives in the reducer.

**No optimistic update on respond.** An optimistic dismissal that loses the first-answer-wins race
would show the user a resolved dialog the agent never received an answer for. `respond` delegates and
lets the resulting `agent_ui_resolved` broadcast drive state.

## Scope references

- `swe/features/extension-ui-client-sdk.md` § Controller, § Rehydration, § Disconnect,
  § Agent lifecycle, § Error handling & edge cases
- `packages/client/src/pistudio-client.ts` — task-001's five members; **`get connection(): DaemonClient`
  (line 353)** is the existing seam for connection-state events (no new facade method is needed);
  `client.connection.onSessionMessage` + task-001's `isAgentArchived`/`isAgentDeleted` for the
  archive/delete feed. **Not `onAgentUpdate` (line 418)** — see § Pruning below
- `packages/client/src/daemon-client.ts` — `onStateChange` (line 265), `ConnectionState`
  (line 27: `"idle" | "connecting" | "open" | "closing" | "closed"`), `hasFeature` (line 134)
- `packages/client/src/agent-ui-state.ts` — task-002's `reduce`, actions, effects, `initialAgentUiState`
- `packages/client/src/pistudio-client.test.ts` — `makeScriptedDaemon` (line 12), whose `push` and
  **`drop`** are exactly the two levers these tests need
- `packages/client/src/reconnect.ts` — the package's existing reconnect/capability-rehydrate driver;
  read it before adding a second reconnect notion, and follow its state-transition vocabulary

## What to build

Create `packages/client/src/agent-ui-controller.ts`.

```ts
export interface AgentUiController {
  getState(): AgentUiState;
  /** Fires on every committed transition; `effects` are the effects of that transition only. */
  subscribe(listener: (state: AgentUiState, effects: AgentUiEffect[]) => void): () => void;
  respond(uiRequestId: string, response: AgentUiResponse): Promise<AgentUiRespondResult>;
  /** Escape hatch; reconnect already triggers this internally. */
  resync(): Promise<void>;
  dispose(): void;
}
export function createAgentUiController(
  client: PiStudioClient,
  opts?: { onUnknownMethod?: (method: string) => void },
): AgentUiController;
```

Behavior:

- **Construction** attaches, in this order: `onAgentUiRequest`, `onAgentUiResolved`,
  `client.connection.onSessionMessage` (for pruning), `client.connection.onStateChange` (for
  reconnect). Then, if
  `client.extensionUiAvailable()`, it kicks off the first `resync()`.
- **Capability gating** — when `extensionUiAvailable()` is false the controller stays inert: no
  `listAgentUi` call (an ungated one earns an `rpc_error` from an older daemon), state stays
  `initialAgentUiState`, and broadcasts that cannot arrive are simply never seen. Re-check on each
  reconnect, because the daemon on the other end may have been upgraded.
- **`resync()`** — set queueing mode on, `await client.listAgentUi()`, dispatch `snapshot`, then
  dispatch only the queued **transient** events (drop queued dialog/surface ones), then leave
  queueing mode. Guard with a **generation counter**: a resync superseded by a newer one must not
  commit its snapshot or drain its queue (last write wins, and the controller serialises its own
  calls so overlap cannot originate internally). A failed `listAgentUi` (`AgentUiError`) must leave
  the controller usable — log/report, keep prior state, do not wedge queueing mode on. Classify a
  queued event with the **same predicate ladder** as the reducer (`expectsResponse` / `surfaceKey`),
  not a method list.
- **Reconnect** — on `onStateChange`: `"closed"`/`"closing"` → dispatch `disconnected`; `"open"` →
  `resync()`. Ignore `"idle"`/`"connecting"`. The first `"open"` after construction must not produce
  a duplicate initial snapshot (dedupe against the constructor's kick-off).
- **Pruning** — narrow `client.connection.onSessionMessage` with task-001's `isAgentArchived` /
  `isAgentDeleted` guards and dispatch `agent_removed` for the message's `agentId`. Idempotent: a
  repeat for an already-pruned agent is a no-op.

  **Do not wire this to `onAgentUpdate` — it can never fire for this.** Verified on both sides:
  `AgentManager.archiveAgent` (`agent-manager.ts:246`) and `deleteAgent` (`:299`) call
  `broadcastArchived` (`:234`) / `broadcastDeleted` (`:288`) **exclusively**, and never the
  `agent_update`-emitting `broadcast(record)` (`:125`, whose only call sites are `:149` and `:212`),
  so archiving an agent produces **zero** `agent_update` traffic — while
  `PiStudioClient.onAgentUpdate` (`pistudio-client.ts:418-422`) filters `type === "agent_update"`
  and nothing else. Both bootstraps do fan the real messages out to every session
  (`bootstrap.ts:271-274`, `dev-bootstrap.ts:112-115`), so the events are there to be read — just
  under a different `type`. Mis-wiring this fails **silently and partially**: dialogs would still
  clear (the daemon broadcasts `agent_ui_resolved` for those), so only surfaces would leak, only
  after an archive, only for clients that never re-snapshot.
- **Unknown fire-and-forget** — a `ui_request` classified transient whose reduction returns **zero**
  effects is the unknown-method signal (task-002). Report it via `opts.onUnknownMethod` (and a
  `console.warn` fallback) **once per method**, deduped for the controller's lifetime.
- **`dispose()`** tears down all four subscriptions (two `agent_ui_*`, one `onSessionMessage`, one
  `onStateChange`) and makes later dispatches no-ops.

## Out of scope

- Rendering, and any React/web-client integration (sibling UI scope).
- Cross-package E2E against a real daemon (task-004).
- Persisting state anywhere — the daemon is the authority and re-derives on demand.
- Replacing or extending `reconnect.ts`; this controller only *observes* connection state.
- Any change to task-002's reducer semantics. If a test here wants different reducer behavior, fix
  the reducer in task-002's file and its own tests — do not fork the logic into the controller.

## Acceptance criteria

- [ ] **Subscribe-then-list:** an `agent_ui_request` pushed *while* `listAgentUi` is in flight is
      present in state exactly once afterwards (not dropped, not duplicated) — driven by pushing on
      the scripted transport between request and reply.
- [ ] A queued **surface** upsert delivered during an in-flight `listAgentUi` is **discarded**, so an
      older queued payload never overwrites the snapshot's newer value for the same
      `(agentId, surfaceKey)`.
- [ ] A queued **transient** delivered during an in-flight `listAgentUi` emits its effect **exactly
      once** after the snapshot commits.
- [ ] **Reconnect without any consumer call:** `drop()` marks pending `answerable: false`; a
      subsequent `"open"` triggers `resync()` automatically and the surviving entries flip back to
      `answerable: true`.
- [ ] Two overlapping `resync()` calls commit only the newer snapshot (generation guard), and the
      superseded one drains no queue.
- [ ] A rejected `listAgentUi` leaves prior state intact, reports the error, and a later `resync()`
      still succeeds (queueing mode not stuck on).
- [ ] With `features.extensionUi` absent: no `agent_ui_list_request` is ever sent, and state stays
      empty; after a reconnect where the flag is now present, the controller syncs.
- [ ] `respond` returns task-001's `AgentUiRespondResult` unchanged and performs **no** optimistic
      state change — the entry disappears only when `agent_ui_resolved` arrives.
- [ ] A real `agent_archived` session message dispatches `agent_removed`: that agent's surfaces are
      gone and other agents' state is untouched. Repeating it is a no-op. Same for `agent_deleted`.
- [ ] An `agent_update` message for the same agent prunes **nothing** — a regression lock on the
      mis-wiring above, which would otherwise pass every other test in this file.
- [ ] An unknown fire-and-forget method reports via `onUnknownMethod` **once**, even after three
      deliveries; a second, different unknown method reports separately.
- [ ] `subscribe` listeners receive the effects of their own transition only (never a re-delivery of
      an earlier transition's effects), and stop firing after their unsubscribe thunk.
- [ ] `dispose()` detaches everything: later pushes, state transitions and `agent_update`s change
      nothing and throw nothing.

## Test / verification plan

- Build: `npm run build:client` succeeds.
- Typecheck: `npm run typecheck` succeeds.
- Lint/format: `npx oxlint packages/client/src/agent-ui-controller.ts` and `npx oxfmt --check` on the
  new files, clean.
- Tests: create `packages/client/src/agent-ui-controller.test.ts` against `makeScriptedDaemon`
  (extract/share it from `pistudio-client.test.ts` if reuse is cleaner than duplication — prefer
  sharing, and if extracted, keep `pistudio-client.test.ts` green). Use `push` for broadcasts and
  `drop` for the disconnect/reconnect cases; the `agent_ui_list_request` arm must be answerable with
  a **deferred** reply so the in-flight-window criteria are testable. Run
  `npx vitest run packages/client/src/agent-ui-controller.test.ts packages/client/src/pistudio-client.test.ts`;
  all pass.

## Notes

- `makeScriptedDaemon` currently replies from a synchronous `respond()` switch via `queueMicrotask`.
  The in-flight-window tests need a reply the test controls; add an opt-in "hold this response until
  I release it" hook rather than reworking the harness's default path.
- `PiStudioClient.daemon` is **private**; use the public `get connection()` (line 353). Do not widen
  the field's visibility.
- Effects are delivered through `subscribe`, not performed. The controller must not import anything
  DOM-, toast- or composer-related — that is the UI scope's job.
- Keep the queue bounded in spirit: a snapshot always clears it, and it only fills during one
  in-flight RPC. Do not add a size cap without evidence one is needed.
