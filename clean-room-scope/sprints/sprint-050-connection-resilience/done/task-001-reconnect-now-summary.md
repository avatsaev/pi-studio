# Task 001 — Summary

## What was built

Added `ReconnectionManager.reconnectNow()` to `packages/client/src/reconnect.ts`, plus the
supporting re-entrancy fix it depends on:

- **`reconnectNow()`** — cancels any pending backoff timer, resets `attempt` to 0, and invokes
  `tryReconnect()` directly (bypassing `scheduleReconnect()`'s delay). Guarded, in order: not
  `active` → no-op; a reconnect already in flight → no-op; `daemon.state !== "closed"` → no-op.
  A successful forced reconnect notifies `onReconnected` with `{ attempt: 0, serverId }`.
- **New private `reconnecting` flag** — set on entry to `tryReconnect()`, cleared in a `finally`.
  Checked by both `reconnectNow()` and the scheduled-timer callback, closing the race where a
  timer firing at the same moment as a `reconnectNow()` call could start two overlapping
  `daemon.connect()` calls.
- **Single-armed `scheduleReconnect()`** — gained `if (this.timer) return;` at the top. Fixes a
  pre-existing bug: a failed reconnect attempt fires *both* the transport's close event (→
  `closed` transition → `scheduleReconnect()`) *and* `tryReconnect()`'s own `catch` (→
  `scheduleReconnect()` again), which previously armed two timers, leaked the first handle, and
  climbed the backoff ladder two rungs per failure. The guard also makes `reconnectNow()`'s
  `clearTimer` call authoritative (at most one pending timer ever exists).

No caller was added — `connection-store.ts` is untouched; this task is deliberately inert on its
own so task-003 can add the callers as a small, reviewable follow-up.

## Files changed

- `packages/client/src/reconnect.ts` — `reconnectNow()`, `reconnecting` flag, single-armed
  `scheduleReconnect()`.
- `packages/client/src/terminal-router.test.ts` — extended `describe("ReconnectionManager")` with
  a nested `describe("reconnectNow()")` (9 new cases) plus two new test-file helpers:
  `makeManualTimer()` (control exactly when a scheduled reconnect fires) and
  `onceReconnected()`/`onceReconnectFailed()` (deterministic event-based waits, replacing
  arbitrary real-timer flushes for the new async cases). `makeFakeTransport()` gained a
  `setShouldFail()` toggle so a reconnect attempt can be made to fail on demand, closing its
  `onClose` the way a real WebSocket does for a failed connection attempt.
- `packages/client/AGENTS.md` — documented `reconnectNow()` under `ReconnectionManager` (guards,
  the `attempt: 0` convention, the single-armed-timer invariant it relies on).

## Commands run + results

- `npx vitest run packages/client/src/terminal-router.test.ts` — **15/15 pass** (6 pre-existing +
  9 new).
- `npx vitest run packages/client` — **57/57 pass** (full package suite, confirms no regression
  in `daemon-client.test.ts`, `pistudio-client.test.ts`, etc.)
- `npm run build:client` (`tsc -b packages/client`) — succeeds, no type errors.
- `npx oxlint packages/client/src/reconnect.ts packages/client/src/terminal-router.test.ts` — 0
  errors.
- `npx oxfmt packages/client/src/reconnect.ts packages/client/src/terminal-router.test.ts` — ran
  (no diff beyond the new content).

## Acceptance criteria status

- [x] `reconnectNow()` on a manager that was never `start()`ed does nothing.
- [x] `reconnectNow()` after `stop()` does nothing.
- [x] `reconnectNow()` while the daemon is `open` does nothing.
- [x] With a pending backoff timer armed, `reconnectNow()` cancels it and performs exactly one
      `connect()`.
- [x] Two `reconnectNow()` calls racing one in-flight attempt produce exactly one `connect()`.
- [x] After a `reconnectNow()` whose `connect()` rejects, the next scheduled delay is the rung-1
      delay (attempt counter reset).
- [x] A failed attempt whose transport also emits a close event arms exactly one new timer and
      increments the attempt counter exactly once.
- [x] A successful forced reconnect notifies `onReconnected` with `attempt === 0`.
- [x] Every pre-existing `ReconnectionManager` test still passes unmodified.

## Follow-ups / TODO(verify)

None. `reconnectNow()` is unused until task-003 wires `resume-triggers.ts` to call it — expected
per this task's scope.
