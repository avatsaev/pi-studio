# Task 004 — Handlers, tap wiring in both bootstraps, dev-daemon E2E incl. redaction scenario

- **Sprint:** sprint-085-daemon-log-streaming
- **Status:** done
- **Type:** feature
- **Area:** packages/server (observability, daemon)
- **Priority:** P1
- **Estimated size:** M
- **Depends on:** task-001, task-003, s083/task-002

## Goal

Log streaming works over a real socket. No sentinel secret from a full agent and extension-UI
scenario ever reaches a log push.

## Context / why

`bootstrap.ts` uses `opts.logger ?? createDaemonLogger(home)`, and `dev-bootstrap.ts` uses
`opts.logger ?? createDaemonLogger(undefined)`. The tap must exist before the logger is built and
can only be attached when the bootstrap builds its own logger. An injected logger leaves the stream
empty (`effectiveLevel:"silent"`), which is documented as such and is not an error. For tests, the
bootstrap options gain an optional `logTap` so an injected
`createLogger({tap, level, stdoutStream})` logger and the service share one tap.

## Scope references

- swe/features/daemon-log-streaming.md § Tapping pino (injected logger), § Redaction expectations,
  § Acceptance criteria (live delivery, injected/silent, redaction, authenticated only),
  § TODO(verify) (tap before logger)
- packages/server/src/daemon/bootstrap.ts (logger construction, `onSessionClose` :743),
  daemon/dev-bootstrap.ts
- packages/server/src/test-support/daemon-test-client.ts (s083/t002)

## What to build

- `observability/daemon-logs-rpc.ts`: `registerDaemonLogsHandlers(registry, {service})`.
- Both bootstraps:
  - create the `LogTap` (or accept `opts.logTap`);
  - pass it to `createDaemonLogger` only when building their own logger;
  - construct the service and register the handlers;
  - compose `onSessionClose` alongside the status service.
- `packages/server/src/daemon/daemon-logs-e2e.test.ts` on the dev daemon:
  - live delivery within 1 s;
  - the `minLevel` filter;
  - the `tail` backlog;
  - unsubscribe and close stop pushes;
  - a `silentLogger()` daemon answers `ok:true` with no lines.
- Redaction scenario on a tapped dev daemon at `trace`:
  - create an agent, send a prompt containing a sentinel;
  - raise a `#ui` dialog with a sentinel payload and answer it with a sentinel;
  - assert no pushed or backlogged line contains any sentinel.
  If a sentinel leaks, fix the call site that logs it (existing invariant) rather than widening the
  sanitizer.
- Auth: a password-protected server proves unauthenticated sockets cannot subscribe.

## Acceptance criteria

- [ ] All of the above pass, with no real-time waits beyond the 100 ms flush.
- [ ] `server_info.features` is still unchanged (the flag is task-006).

## Test / verification plan

- `npx vitest run packages/server/src/daemon packages/server/src/observability packages/server/src/logging`
- `npm run build:server`
