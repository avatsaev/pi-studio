# Task 005 — Advertise `daemonObservability`; stage 2 fixtures — Summary

- **Sprint:** sprints/sprint-085-daemon-log-streaming
- **Completed:** 2026-11-13
- **Status:** done

## What was implemented
`SERVER_FEATURES.daemonObservability` (+ COMPAT entry) is advertised on the direct and relay
handshakes. `daemonStatusRpc` is untouched and handler-less (`rpc_error unknown_message_type`).
13 stage 2 fixtures (`stage: 2`, `requiresFeature: "daemonObservability"`) for the status and logs
families, manifest entries (requests carry `response`), regenerated `.signatures.json`, CHANGELOG
line (additive, `formatVersion` stays 1). The shared scenario gained the stage 2 steps (status
one-shot, subscribe → real 5 s push → unsubscribe; log subscribe with `tail: 1`, live push,
unsubscribe) and `scenarioDaemonOptions()` (tapped silent logger + turn delay) used by Layer B and
the recorder.

## Files created / changed
| File | Change |
|------|--------|
| `packages/protocol/src/client-capabilities.ts` | flag + COMPAT |
| `packages/protocol/src/client-capabilities.test.ts`, `session-messages.test.ts` | key-set / flag assertions |
| `packages/protocol/src/messages.ts`, `server/src/observability/daemon-{logs,status}-rpc.ts` | comments now say the flag is shipped |
| `packages/protocol/fixtures/external-clients/*` | 13 fixtures, manifest, CHANGELOG, `.signatures.json` |
| `packages/server/src/test-support/external-fixtures-scenario.ts` | stage 2 steps, `variantKey` cases, `scenarioDaemonOptions` |
| `packages/server/src/daemon/external-fixtures-e2e.test.ts`, `scripts/record-external-fixtures.ts` | use `scenarioDaemonOptions`; log backlog line before the logs subscribe input |
| `packages/server/src/daemon/daemon-status-e2e.test.ts`, `bootstrap.test.ts` | flag true (direct + relay); `daemonStatusRpc` still rpc_error |

## Build & test results
```
$ npm run build:protocol && npm run build:server       # success
$ npm run fixtures:update -w @av-pi-studio/protocol    # wrote .signatures.json
$ npx vitest run packages/protocol + external-fixtures-e2e + daemon-status-e2e + daemon-logs-e2e
15 files, 341 passed, 0 failed
$ npx oxlint / oxfmt --check on changed files          # clean
```

## Acceptance criteria
- [x] flag true on dev handshake (daemon-status-e2e) and relay handshake (bootstrap.test relay test); `daemonStatusRpc` present, handler-less (daemon-status-e2e)
- [x] Layer A (74) and Layer B (67) pass incl. new fixtures and coverage guard

## Follow-ups / TODO(verify)
- Layer B waits one real 5 s status interval in the scenario (beforeAll timeout raised to 45 s).
