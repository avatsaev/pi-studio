# Task 003 — `DaemonLogsService`: filter, 200 lines/s bucket, 100 ms batcher, `dropped`

- **Sprint:** sprint-085-daemon-log-streaming
- **Status:** done
- **Type:** feature
- **Area:** packages/server (observability)
- **Priority:** P1
- **Estimated size:** M
- **Depends on:** task-002

## Goal

Each subscribed session gets its own filtered, rate-capped, batched stream with an honest
drop counter. Other subscribers are unaffected.

## Scope references

- swe/features/daemon-log-streaming.md § Subscribe / deliver / cap (pseudo-code), § Per-session
  lifecycle, § Error handling & edge cases
- packages/server/src/logging/log-tap.ts (task-002)

## What to build

- `packages/server/src/observability/daemon-logs-service.ts`, with an injected tap, a monotonic
  `now`, timers, and `send(session, message)`.
- `subscribe(session, minLevel, tail?)`:
  - validates `invalid_level` and `invalid_tail` (integer 0..1000, default 0), leaving any
    existing subscription untouched on error;
  - replaces the session's existing subscription and resets its limiter;
  - returns `{ok:true, minLevel, effectiveLevel, lines: backlog, dropped: 0}`;
  - `effectiveLevel` is the stricter of the daemon level and `minLevel`, or `"silent"` when the
    tap is unattached.
- Per-line delivery:
  - token bucket of 200/s with a burst of 200;
  - overflow increments `droppedSinceLastPush`;
  - a 100 ms flush timer runs only while there is pending data;
  - each flush sends up to 200 lines as `daemon_log_lines {lines, dropped}`;
  - an empty `lines` with `dropped > 0` is sent when needed;
  - a send failure removes the subscriber.
- `unsubscribe(session)` (idempotent) and `disposeSession(session)`.

## Acceptance criteria

- [ ] On a fake clock, a 1000-line burst within one second delivers 200 or fewer lines that
  second, and the summed `dropped` equals 1000 − delivered. A trailing empty push carries the
  remainder.
- [ ] A second subscriber receives its own full quota while the first is dropping.
- [ ] `warn` subscribers never see info/debug lines. Re-subscribing at `info` starts info delivery.
- [ ] A daemon at `info` with a `debug` request yields `effectiveLevel:"info"`.
- [ ] After unsubscribe or dispose, no pushes and no pending flush timer. With zero subscribers, no
  timer.
- [ ] `tail: 1001` → `invalid_tail`, `minLevel:"loud"` → `invalid_level`, and the previous
  subscription is still active after either.

## Test / verification plan

- `npx vitest run packages/server/src/observability`; `npm run build:server`
