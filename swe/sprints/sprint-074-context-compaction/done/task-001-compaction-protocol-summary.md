# Task 001 — Protocol: `compaction` stream event, compact-response estimate, `compactionEvents` flag — Summary

- **Sprint:** sprints/sprint-074-context-compaction
- **Completed:** 2026-10-09
- **Status:** done

## What was implemented
`compaction` variant appended to `agentStreamEventSchema` (phase enum, `compactionId`, optional
reason/tokensBefore/estimatedTokensAfter/summary/error/willRetry), `estimatedTokensAfter` on
`agentCompactResponseSchema.payload`, and `SERVER_FEATURES.compactionEvents` + COMPAT tag
(advertised automatically: both `ws-server.ts` and `bootstrap.ts` spread `SERVER_FEATURES`).

## Files created / changed
| File | Change |
|------|--------|
| `packages/protocol/src/messages.ts` | modified |
| `packages/protocol/src/client-capabilities.ts` | modified |
| `packages/protocol/src/session-messages.test.ts` | tests: phases, rejections, response field |
| `packages/protocol/src/client-capabilities.test.ts` | flag list |
| `packages/protocol/AGENTS.md` | event kind + flag documented |

## Build & test results
```
$ npx vitest run packages/protocol   -> 10 files, 119 passed
$ npm run build:protocol             -> success
$ npx oxfmt <changed>; npx oxlint packages/protocol -> clean
```

## Acceptance criteria
- [x] Four phases parse; unknown phase / reason / missing compactionId rejected
- [x] `agent_compact_response` exposes `estimatedTokensAfter`
- [x] Flag + COMPAT exist; capability tests pass

## Follow-ups / TODO(verify)
- Root `AGENTS.md` protocol paragraph is task-009.
