# Task 001 — `ReconnectionManager.reconnectNow()`

- **Sprint:** sprint-050-connection-resilience
- **Status:** backlog
- **Type:** feature
- **Area:** packages/client (SDK)
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** none

## Goal

Add an additive `reconnectNow()` to `ReconnectionManager` so an external signal (tab became
visible, OS reports network back) can bypass the pending backoff delay and attempt a reconnect
immediately.

## Context / why

`ReconnectionManager` today can only move from `closed` toward `open` via the private
`scheduleReconnect()` backoff timer. There is no way for a caller holding the manager to say "the
situation just changed, try again now." Task-003 needs exactly that: when the user returns to a tab
whose connection dropped while hidden, waiting out a 30 s (or throttle-stretched) rung is the wrong
behavior — the strongest available signal that the network may be back is the user looking at the
screen.

This task is SDK-only and inert on its own: nothing calls `reconnectNow()` until task-003. That is
deliberate — it keeps the SDK change reviewable in isolation and leaves the repo fully working after
this task.

## Scope references

- `clean-room-scope/features/connection-resilience.md` § Public Contract → SDK addition;
  § Behavior & Algorithms (the `reconnectNow()` pseudocode block)
- `packages/client/src/reconnect.ts` — modify (`ReconnectionManager`)
- `packages/client/src/terminal-router.test.ts` — extend the existing `describe("ReconnectionManager")`
  block (line ~178). **There is no `reconnect.test.ts`**; the manager's tests live in this file
  alongside its `makeFakeTransport`/`makeClient` helpers. Do not start a new test file for this.
- `packages/client/AGENTS.md` — docs sync

## What to build

Modify: `packages/client/src/reconnect.ts`

Public contract:

```ts
/**
 * Cancel any pending backoff timer and attempt a reconnect immediately, resetting the backoff
 * ladder. No-op unless the manager is active and the daemon is `closed`; no-op while an attempt
 * is already in flight.
 */
reconnectNow(): void;
```

Required behavior:

1. **Guards (all three, in this order).** No-op when `!this.active` (never started, or `stop()`ed —
   an explicit user disconnect must never be resurrected); no-op when an attempt is already in
   flight; no-op unless `this.daemon.state === "closed"` (covers `open`, `connecting`, `closing`,
   `idle` in one condition — never race the store's own in-flight `connect()`).
2. **New private in-flight flag.** `tryReconnect()` is `async` and currently has no re-entrancy
   guard — a scheduled timer firing at the same moment as a `reconnectNow()` call could start two
   overlapping `daemon.connect()` calls. Add a private boolean set on entry to `tryReconnect()` and
   cleared in a `finally`, and honor it in **both** `reconnectNow()` and `scheduleReconnect()`'s
   timer callback.
3. **Reset then fire.** Clear the pending timer (`this.clearTimer`, null the handle), set
   `this.attempt = 0`, then invoke the existing `tryReconnect()` directly — not through
   `scheduleReconnect()`, which would re-introduce a delay.
4. **Failure path is unchanged.** `tryReconnect()`'s existing `catch` calls `scheduleReconnect()`,
   which takes `attempt` 0 → 1 and therefore schedules the rung-1 delay (~500 ms default). This is
   the intended semantics: a forced attempt that fails restarts the ladder from the bottom rather
   than resuming where it left off.
5. **`attempt: 0` is the forced-reconnect signal.** `onReconnected` handlers receive
   `{ attempt: 0, serverId }` for a successful forced reconnect, distinguishing it from ladder
   attempts (which are always ≥ 1). State this in the method docstring — it is a contract, not an
   accident of the counter reset.

## Out of scope

- Any caller. `connection-store.ts` is not touched by this task (task-002 injects timers, task-003
  adds the callers).
- Adding a timer-injection seam to `DaemonClient`'s RPC/ping timeouts — explicitly out of scope per
  the spec's § Out of scope.
- Changing default backoff parameters.

## Acceptance criteria

- [ ] `reconnectNow()` on a manager that was never `start()`ed does nothing (no `connect()` call).
- [ ] `reconnectNow()` after `stop()` does nothing.
- [ ] `reconnectNow()` while the daemon is `open` does nothing.
- [ ] With a pending backoff timer armed after a drop, `reconnectNow()` cancels that timer (the
      injected `clearTimer` is called) and performs exactly one `connect()`.
- [ ] Two `reconnectNow()` calls racing one in-flight attempt produce exactly one `connect()`.
- [ ] After a `reconnectNow()` whose `connect()` rejects, the next scheduled delay is the rung-1
      delay (attempt counter reset), not a continuation of the pre-existing ladder position.
- [ ] A successful forced reconnect notifies `onReconnected` with `attempt === 0`.
- [ ] Every pre-existing `ReconnectionManager` test still passes unmodified.

## Test / verification plan

- Tests: extend `describe("ReconnectionManager")` in `packages/client/src/terminal-router.test.ts`
  with one case per acceptance criterion, reusing the file's existing injected-timer pattern
  (`setTimer`/`clearTimer`/`jitter: 0` options and the fake transport's `drop()`).
- Run: `npx vitest run packages/client/src/terminal-router.test.ts` — all pass.
- Build: `npm run build` succeeds. Typecheck: `npm run typecheck`. Lint: `npx oxlint` on the touched
  files; format with `npx oxfmt` on touched files only (never the whole workspace).

## Notes

- Keep the change strictly additive — `packages/client` is consumed by `cli`, `web-client`, and the
  daemon's own tests; no existing signature may change.
- Docs sync (repo rule): `packages/client/AGENTS.md`'s reconnection section gains `reconnectNow()`
  with the `attempt: 0` convention and the three guards.
