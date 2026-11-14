# Task 001 — Protocol: `daemon_logs_*` and `daemon_log_lines` schemas — Summary

- **Sprint:** sprints/sprint-085-daemon-log-streaming
- **Completed:** 2026-11-13
- **Status:** done

## What was implemented
`logLineSchema`, `daemonLogsSubscribe{Request,Response}Schema`, `daemonLogsUnsubscribe{Request,Response}Schema` and the push `daemonLogLinesSchema`, all `.passthrough()` and members of `sessionMessageSchema`. `minLevel`/`tail` are loose (`string`/`number`) so bad values reach the handler; `LogLine.level` is an open string.

## Files created / changed
| File | Change |
|------|--------|
| `packages/protocol/src/messages.ts` | modified (schemas + union entries) |
| `packages/protocol/src/session-messages.test.ts` | added tests |
| `packages/protocol/AGENTS.md` | modified (API table) |

## How it satisfies the scope
Matches feature spec § Wire messages. `SERVER_FEATURES` untouched.

## Build & test results
```
$ npx vitest run packages/protocol   -> 188 passed, 0 failed
$ npm run build:protocol             -> success
$ npx oxlint / oxfmt (changed files) -> clean
```

## Acceptance criteria
- [x] Round-trip tests per message, out-of-range `tail` and unknown level parse (session-messages.test.ts)
- [x] `SERVER_FEATURES` unchanged (asserted)

## Follow-ups / TODO(verify)
- None.
