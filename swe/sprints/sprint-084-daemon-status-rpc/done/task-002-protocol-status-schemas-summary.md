# Task 002 — Protocol daemon_status_* schemas — Summary

- **Sprint:** sprints/sprint-084-daemon-status-rpc
- **Completed:** 2026-11-13
- **Status:** done

## What was implemented
`daemonClientInfoSchema`, `daemonStatusSchema` and seven `daemon_status_*` message schemas (all `.passthrough()`, union members, types exported) in `packages/protocol/src/messages.ts`. `transport` is a strict `z.enum(["direct","relay"])` (both values daemon-defined; spec lists exactly these). `SERVER_FEATURES` unchanged.

## Files created / changed
| File | Change |
|------|--------|
| `packages/protocol/src/messages.ts` | schemas + union entries |
| `packages/protocol/src/session-messages.test.ts` | round-trip/passthrough/flag-untouched tests |
| `packages/protocol/AGENTS.md` | API table rows |

## Build & test results
```
$ npm run build:protocol -> success
$ npx vitest run packages/protocol -> 11 files, 185 passed
$ npx oxlint <changed> -> clean
```

## Acceptance criteria
- [x] Round-trip tests parse each message; unknown fields survive.
- [x] `SERVER_FEATURES` unchanged; `daemonStatusRpc` untouched.

## Follow-ups / TODO(verify)
- Fixtures under `packages/protocol/fixtures/external-clients/` are not part of tasks 1-4 (sprint scope later).
