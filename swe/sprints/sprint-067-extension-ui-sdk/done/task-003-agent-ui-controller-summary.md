# Task 003 — `agent-ui-controller.ts`: subscribe-then-list, automatic reconnect resync, agent pruning — Summary

- **Sprint:** sprint-067-extension-ui-sdk
- **Completed:** 2026-08-21
- **Status:** done

## What was implemented

`packages/client/src/agent-ui-controller.ts` — the impure wiring layer that drives task-002's
reducer from task-001's SDK. `createAgentUiController(client, opts?)` returns
`{ getState, subscribe, respond, resync, dispose }` and owns:

- **Subscribe-then-list rehydration.** Construction attaches `onAgentUiRequest`/`onAgentUiResolved`
  (queueing while a `listAgentUi()` is in flight), `connection.onSessionMessage` (pruning), and
  `connection.onStateChange` (reconnect) — in that order — then kicks off the first `resync()` if
  the daemon is already capable. On snapshot: dispatch `snapshot`, then replay only the queued
  events that classify as **transient** (same predicate ladder as the reducer, never a method
  list); every queued dialog/surface event is discarded, since ordered delivery guarantees a
  faithful daemon's snapshot already reflects it.
- **Automatic reconnect**, never left to the consumer: `"closed"`/`"closing"` dispatches
  `disconnected`; `"open"` triggers `resync()` internally, re-checking `extensionUiAvailable()`
  every time (the daemon on the other end may have been upgraded).
- **Generation-guarded overlap.** A monotonic counter is bumped at the start of every `resync()`
  attempt; only the response matching the *current* generation commits — last write wins by start
  order, not response-arrival order. A resync that finds queueing already active joins the existing
  window instead of resetting it, so no in-flight transient is silently dropped when a second
  resync overlaps the first.
- **Agent-lifecycle pruning off `agent_archived`/`agent_deleted`, never `onAgentUpdate`** — verified
  in task-001 that the latter can never fire for an archive/delete.
- **Unknown fire-and-forget reporting**, deduped per method for the controller's lifetime, via
  `opts.onUnknownMethod` or a `console.warn` fallback — reusing "transient classification + zero
  effects" as the detection signal, exactly as task-002 designed it.
- **No optimistic `respond`** — delegates to `client.respondToUi` and lets the resulting
  `agent_ui_resolved` broadcast drive state removal.

## Files created / changed

| File | Change |
|---|---|
| `packages/client/src/agent-ui-controller.ts` | created — `AgentUiController`, `createAgentUiController` |
| `packages/client/src/agent-ui-controller.test.ts` | created — 15 tests covering every acceptance criterion |
| `packages/client/src/test-support/scripted-daemon.ts` | created — `makeScriptedDaemon`/`makeFacade` extracted from `pistudio-client.test.ts` (now shared by both test files); `features` exposed as a **live, mutable** object so a test can flip a flag before a simulated reconnect |
| `packages/client/src/pistudio-client.test.ts` | harness extracted; imports `makeFacade`/`makeScriptedDaemon` from the new shared module instead of defining its own copy — kept green (43 tests) |
| `packages/client/src/index.ts` | added `export * from "./agent-ui-controller.js"` |

## How it satisfies the scope

Implements `swe/features/extension-ui-client-sdk.md` § Controller, § Rehydration, § Disconnect,
§ Agent lifecycle, § Error handling & edge cases, and task-003's own § What to build verbatim — the
exported interface/function signatures match the task's `ts` block exactly.

One deliberate deviation from a literal reading of "reset the queue on every resync start": the
task's algorithm section describes resync as "set queueing mode on, await, dispatch snapshot, drain
queue" without addressing what a *second*, overlapping `resync()` call should do to the *first*
one's already-collected queue. Resetting the queue on every `resync()` start (including an
overlapping one) would silently drop any transient collected between the first call's start and the
second call's start — a live "unknown fire-and-forget" or `notify`/`set_editor_text` event would
simply vanish. Instead, the queue only resets when transitioning from *not* queueing to queueing;
an overlapping resync joins the existing window. This still satisfies the literal acceptance
criterion ("the superseded one drains no queue" — enforced by the generation check, independent of
this choice) while additionally not losing transients during the overlap. Documented in the code's
`resync()` comment.

## Build & test results

```
$ npx tsc -b --force
(no output — clean)

$ npx oxlint packages/client/src/agent-ui-controller.ts packages/client/src/agent-ui-controller.test.ts packages/client/src/test-support/scripted-daemon.ts packages/client/src/index.ts
(no output — clean)

$ npx oxfmt --check packages/client/src/agent-ui-controller.ts packages/client/src/agent-ui-controller.test.ts packages/client/src/test-support/scripted-daemon.ts packages/client/src/index.ts
All matched files use the correct format.

$ npx vitest run packages/client/src/agent-ui-controller.test.ts packages/client/src/pistudio-client.test.ts packages/client/src/agent-ui-state.test.ts
 Test Files  3 passed (3)
      Tests  92 passed (92)
```

## Acceptance criteria

- [x] **Subscribe-then-list:** an `agent_ui_request` pushed while `listAgentUi` is in flight is
      present exactly once afterwards — verified sourced from the snapshot rebuild (no `receivedAt`,
      proving it was discarded-and-recovered-from-snapshot, not duplicated by a live replay on top).
- [x] A queued surface upsert during an in-flight `listAgentUi` is discarded — the snapshot's value
      for the same `(agentId, surfaceKey)` wins even though it was scripted as "older" in send order.
- [x] A queued transient emits its effect exactly once, after the snapshot commits.
- [x] Reconnect without any consumer call: `drop()` → `answerable: false`; a subsequent `"open"`
      (via `daemon.connect()` again) auto-resyncs and flips surviving entries back to `answerable: true`.
- [x] Two overlapping `resync()` calls commit only the newer snapshot regardless of reply order;
      the superseded response never touches state.
- [x] A rejected `listAgentUi` leaves prior state intact, calls `console.error`, and a later
      `resync()` still succeeds (queueing mode not stuck).
- [x] With `features.extensionUi` absent: zero `agent_ui_list_request` ever sent, state stays
      `{ pending: {}, surfaces: {} }`; after a reconnect where the flag is now present, exactly one
      `agent_ui_list_request` is sent and the controller syncs.
- [x] Construction against an already-open, capable client sends exactly one initial
      `agent_ui_list_request` (no duplicate).
- [x] `respond` returns the SDK's `AgentUiRespondResult` unchanged; no optimistic removal — the
      entry survives the RPC round-trip and disappears only on a real `agent_ui_resolved`.
- [x] A real `agent_archived` dispatches `agent_removed`: that agent's pending+surfaces gone, other
      agents untouched, repeating is a no-op. Same verified for `agent_deleted`.
- [x] An `agent_update` message for the same agent prunes nothing — regression lock.
- [x] An unknown fire-and-forget method reports via `onUnknownMethod` once, even after three
      deliveries; a different unknown method reports separately.
- [x] `subscribe` listeners receive only their own transition's effects (a listener added after an
      earlier transition never sees that transition's effects), and stop firing after unsubscribe.
- [x] `dispose()` detaches everything: pushes, `agent_archived`, `agent_update`, and `drop()` after
      dispose change nothing and throw nothing.

## Follow-ups / TODO(verify)

- task-004 (E2E against a real dev daemon + real-Pi smoke, docs sync) consumes this controller
  directly against a genuine daemon rather than the scripted transport — the one scenario this
  task's harness cannot exercise is the real ordering guarantee the "subscribe-then-list" design
  leans on (that a faithful daemon's snapshot always reflects an event the client saw first); task-004
  is where that assumption gets its first non-scripted proof.
