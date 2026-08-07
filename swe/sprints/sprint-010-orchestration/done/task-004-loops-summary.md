# Task 004 — Loops (iterative agent runs with verifiers) — Summary

- **Sprint:** sprint-010-orchestration
- **Completed:** 2026-06-11
- **Status:** done

## What was implemented
`packages/server/src/orchestration/loop-service.ts` — `LoopService` over `loops/loops.json` (the
queued, non-atomic loop store):
- **Ops:** `run` (create + run to completion), `list`, `inspect`, `logs(id, sinceSeq)`, `stop`.
- **`runLoop(rec)`** — while not stop-requested and within `maxIterations`/`maxTimeMs`:
  1. create a **worker** agent (worker overrides ?? loop defaults) → record `workerOutcome`;
     `archive:true` archives the worker after use;
  2. run each `verifyChecks` shell command → `LoopVerifyCheckResult` (`passed = exitCode===0`);
  3. if `verifyPrompt`, run a **verifier** agent → `LoopVerifyPromptResult`;
  4. iteration succeeds only if the worker completed **AND** all checks **AND** the verifier pass →
     loop `succeeded` + break; otherwise `sleep(sleepMs)` and continue.
  - Stop requested → `stopped` (after the current step); caps exhausted without success → `failed`;
    `completedAt` stamped.
- **Logs** appended with a monotonic `seq` (`nextLogSeq`) for incremental paging.
- **`recover()`** — boot recovery: `running` loops → `stopped` with an interruption log entry (the
  hook wired into `AgentManager.recover` from sprint-005).
- Rich nested types (`LoopIteration`, `LoopVerifyCheckResult`, `LoopVerifyPromptResult`,
  `LoopLogEntry`) defined in the service; added worker/verifier override + timestamp fields to
  `loopRecordSchema`.

## Files created / changed
| File | Change |
|------|--------|
| `packages/server/src/orchestration/loop-service.ts` | created |
| `packages/server/src/orchestration/index.ts` | modified (re-export) |
| `packages/server/src/persistence/entity-schemas.ts` | modified (loop worker/verifier + timestamp fields) |
| `packages/server/src/orchestration/loop-service.test.ts` | added — 7 tests (mock worker/verifier) |

## Build & test results
```
$ npm run build:server                                                   → exit 0
$ npx vitest run packages/server/src/orchestration/loop-service.test.ts  → 7 passed
$ npx oxlint / oxfmt --check packages/server/src/orchestration            → clean
```

## Acceptance criteria
- [x] A loop creates a worker per iteration and records its outcome.
- [x] All `verifyChecks` and the optional `verifyPrompt` must pass for an iteration to succeed.
- [x] First successful iteration ends the loop `succeeded`; exceeding caps ends `failed`.
- [x] Stop yields `stopped` after the current step; `archive:true` archives workers each iteration.
- [x] Restart recovers a running loop as `stopped` with a log entry.

## Follow-ups / TODO(verify)
- Exact worker-vs-verify-step ordering + whether `sleepMs` applies after success (modeled: checks →
  verifier; sleep only between failed iterations). CLI wiring is sprint-011.
