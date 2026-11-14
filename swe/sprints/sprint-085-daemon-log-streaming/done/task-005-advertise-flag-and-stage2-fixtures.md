# Task 005 — Advertise `daemonObservability`; stage 2 fixtures for status + logs

- **Sprint:** sprint-085-daemon-log-streaming
- **Status:** done
- **Type:** feature
- **Area:** packages/protocol (client-capabilities, fixtures); packages/server (fixture E2E)
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** task-004, s084/task-005, s083/task-006

## Goal

Both observability families are advertised together under one flag, and pinned for external
clients.

## Context / why

Every `SERVER_FEATURES` key is advertised on both the direct and relay handshakes, so this single
key flips both families on. `daemonStatusRpc` stays exactly as it is: present and handler-less
(D30).

## Scope references

- swe/features/daemon-status-rpc.md § Capability flag, § Acceptance "Flags", "Schemas & fixtures"
- swe/features/daemon-log-streaming.md § Capability flag, § Acceptance "Flag & schemas"
- swe/architecture/external-client-fixtures.md § Required fixture set › Stage 2, § Acceptance
  "Stage 2 additions"
- packages/protocol/src/client-capabilities.ts:44-90 (`SERVER_FEATURES`, COMPAT entries,
  `extensionUi` precedent) and its exact-key-set test

## What to build

- `SERVER_FEATURES.daemonObservability` + `COMPAT(daemonObservability)` entry, plus a key-set
  test update.
- Fixtures with `"stage": 2` and `"requiresFeature": "daemonObservability"`:
  - `daemon_status_request`, `daemon_status_response`, `daemon_status_subscribe_request`,
    `daemon_status_unsubscribe_request`, `daemon_status_update`;
  - `daemon_logs_subscribe_request`, `daemon_logs_unsubscribe_request`, `daemon_log_lines`.
  Add the subscribe/unsubscribe responses too if Layer B pairs inputs with responses.
  Update the manifest and regenerate `.signatures.json`. These are additive, so `formatVersion`
  stays the same, but add a CHANGELOG line.
- Layer B gains the stage 2 scenario: status one-shot and subscribe, plus a log subscription on a
  tapped dev daemon (`opts.logTap` from task-004).

## Acceptance criteria

- [x] `server_info.features.daemonObservability === true` on the dev handshake and in the relay
  handshake test. `daemonStatusRpc` is still present with no handler (`rpc_error
  unknown_message_type` if sent).
- [x] Layer A and Layer B pass, including the new fixtures, and the coverage guard covers them.

## Test / verification plan

- `npx vitest run packages/protocol packages/server/src/daemon/external-fixtures-e2e.test.ts`
- `npm run build:protocol && npm run build:server`
