# Task 004 — SDK + CLI: compaction-length RPC timeout and typing — Summary

- **Sprint:** sprints/sprint-074-context-compaction
- **Completed:** 2026-10-09
- **Status:** done

## What was implemented
Exported `COMPACT_TIMEOUT_MS = 10 * 60_000` from `pistudio-client.ts`; `AgentHandle.compact()` and the CLI's `compactAgent` pass it as the RPC timeout (the CLI imports the constant, no duplicate). `estimatedTokensAfter` is typed via task-001's schema; the scripted-daemon fixture carries it.

## Files created / changed
| File | Change |
|------|--------|
| `packages/client/src/pistudio-client.ts` | modified |
| `packages/client/src/test-support/scripted-daemon.ts` | fixture payload |
| `packages/client/src/pistudio-client.test.ts` | fake-timer tests: outlives default timeout; still times out at `COMPACT_TIMEOUT_MS` with `RpcTimeoutError` |
| `packages/cli/src/agent-commands.ts`, `agent-commands.test.ts` | modified / fake-timer test |
| `packages/client/AGENTS.md`, `packages/cli/AGENTS.md` | documented (incl. `busy` on a running agent) |

## Build & test results
```
$ npx vitest run packages/client packages/cli -> 24 files, 409 passed
$ npm run build:client; npm run build:cli      -> success
$ npx oxlint packages/client packages/cli      -> no warnings in changed files
```

## Acceptance criteria
- [x] `compact()` resolves after a reply held past the 30 s default (and times out at 10 min)
- [x] `compactAgent` waits past the CLI's 50 ms test timeout
- [x] Payload typed with `estimatedTokensAfter`

## Follow-ups / TODO(verify)
- None.
