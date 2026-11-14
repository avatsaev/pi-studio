# Task 001 — Protocol: `daemon_logs_*` and `daemon_log_lines` schemas

- **Sprint:** sprint-085-daemon-log-streaming
- **Status:** done
- **Type:** feature
- **Area:** packages/protocol (messages)
- **Priority:** P1
- **Estimated size:** XS
- **Depends on:** s084/task-002

## Goal

The five log-streaming messages and `LogLine` are real `sessionMessageSchema` members.

## Scope references

- swe/features/daemon-log-streaming.md § Public contract › Wire messages, `LogLine`
- packages/protocol/src/messages.ts (s084/t002's status schemas sit alongside)

## What to build

- `logLineSchema` (`.passthrough()`; `level` as an open string accepting the six names, since
  clients tolerate unknown levels; `fields` optional record).
- The schemas:
  - `daemon_logs_subscribe_request {minLevel, tail?}`;
  - `daemon_logs_subscribe_response` (`{ok:true, minLevel, effectiveLevel, lines, dropped}` |
    `{ok:false, error}`);
  - `daemon_logs_unsubscribe_request`/`_response`;
  - the push `daemon_log_lines {lines, dropped}`.
- `minLevel`/`tail` validation stays **server-side**, so an invalid value reaches the handler
  and gets a domain `invalid_level`/`invalid_tail`, not an `rpc_error`. The request schema is
  loose on those two fields.

## Acceptance criteria

- [ ] Round-trip tests for each message, including an out-of-range `tail` still parsing at the
  protocol layer.
- [ ] `SERVER_FEATURES` is unchanged.

## Test / verification plan

- `npx vitest run packages/protocol`; `npm run build:protocol`
