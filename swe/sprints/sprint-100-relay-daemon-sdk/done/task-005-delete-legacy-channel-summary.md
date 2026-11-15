# Task 005 — Delete the protocol-1 channel — Summary

- **Sprint:** sprints/sprint-100-relay-daemon-sdk
- **Completed:** 2026-11-15
- **Status:** done

## What was implemented
Deleted `packages/relay/src/legacy-channel.ts` and its test, removed the export from `index.ts`, updated `packages/relay/AGENTS.md` (layout, invariant replaced by "Protocol 1 is gone", testing list). `base64.ts` and `deriveRelaySessionId` remain exported.

## Files created / changed
| File | Change |
|------|--------|
| `packages/relay/src/legacy-channel.ts`, `legacy-channel.test.ts` | deleted |
| `packages/relay/src/index.ts` | export removed |
| `packages/relay/AGENTS.md` | updated |

## Build & test results
```
$ git grep -n "Legacy\|e2ee_app\|e2ee_bin\|e2ee_hello\|e2ee_ready" -- 'packages/*/src' (excluding unrelated "Legacy flat/normalization" comments) -> nothing
$ npm run build && npm run typecheck -> success
$ npm test -> 273 files, 3887 passed
```

## Acceptance criteria
- [x] grep finds nothing; relay, server, client, cli build; tests pass

## Follow-ups / TODO(verify)
- Remaining `e2ee_*` mentions in READMEs/docs are rewritten in s101/t002.
