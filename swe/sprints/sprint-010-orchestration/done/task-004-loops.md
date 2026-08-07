# Task 004 — Loops (iterative agent runs with verifiers)

- **Sprint:** sprint-010-orchestration
- **Status:** done
- **Estimated size:** M
- **Depends on:** task-004 (sprint-003, loop store); task-002 (sprint-006, create/run); task-005 (sprint-005, archive)

## Goal
Implement looping agent runs with shell + LLM verifiers and crash recovery.

## Scope references
- `clean-room-scope/features/loops.md` § Operations, § Data shape, § Behavior (runLoop)
- `clean-room-scope/architecture/persistence.md` § Loop (queued, non-atomic)

## What to build
- `loop-service` over `loops/loops.json` (array; queued non-atomic writes).
- Ops (WS/CLI-mirrored): `LoopRunRequest`, `LoopListRequest`, `LoopInspectRequest`, `LoopLogsRequest`,
  `LoopStopRequest`.
- `runLoop(rec)`: while not stopped and within `maxIterations`/`maxTimeMs`: create a worker agent
  (worker overrides or loop defaults), await its turn → `workerOutcome`; if `archive` → archive
  worker; run each `verifyChecks` shell command (record `LoopVerifyCheckResult`); if `verifyPrompt`,
  create a verifier agent to judge (record `LoopVerifyPromptResult`); iteration succeeds only if all
  checks AND the prompt pass → loop `succeeded` + break; else `sleep(sleepMs)` and continue.
  Stop → `stopped`; cap exceeded without success → `failed`.
- Append `LoopLogEntry` with monotonic `seq` for incremental paging. On startup, `running` loops →
  `stopped` with an interruption log entry (the recovery hook from sprint-005).

## Out of scope
- CLI wiring (sprint-011). Notifications.

## Acceptance criteria
- [ ] A loop creates a worker per iteration and records its outcome.
- [ ] All `verifyChecks` and the optional `verifyPrompt` must pass for an iteration to succeed.
- [ ] First successful iteration ends the loop `succeeded`; exceeding caps ends `failed`.
- [ ] Stop yields `stopped` after the current step; `archive:true` archives workers each iteration.
- [ ] Restart recovers a running loop as `stopped` with a log entry.

## Test / verification plan
- Tests: `npx vitest run .../loop-service.test.ts` using `mock` worker/verifier — success break,
  cap failure, stop, archive, restart-recovery.

## Notes
- Ordering of worker vs. verify steps and whether `sleepMs` applies after success are TODO(verify).
