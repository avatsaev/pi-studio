# Loops — Clean Room Scope

> Part of: [MAIN-SCOPE.md](../MAIN-SCOPE.md)
> Related scopes: [agent-sessions.md](agent-sessions.md), [cli.md](cli.md),
> [../architecture/persistence.md](../architecture/persistence.md)

## Purpose

A **loop** runs an agent (the "worker") repeatedly against a prompt until an exit condition is met,
optionally verifying each iteration with shell checks and/or an LLM "verifier" agent (a.k.a. "Ralph
loops"). Used to drive an agent toward clear acceptance criteria with automatic retries.

## Public Contract

### Operations (request → response)
| Operation | Message | CLI |
|-----------|---------|-----|
| Run (start) | `LoopRunRequest` | `pi-studio loop run` |
| List | `LoopListRequest` | `pi-studio loop ls` |
| Inspect | `LoopInspectRequest` | `pi-studio loop inspect` |
| Logs | `LoopLogsRequest` | `pi-studio loop logs` |
| Stop | `LoopStopRequest` | `pi-studio loop stop` |

### Data shape (`loops/loops.json`, array)
Loop record: `id` (8-char), `name?`, `prompt`, `cwd`, `provider`, `model?`, `modeId?`,
`workerProvider?`, `workerModel?`, `verifierProvider?`, `verifierModel?`, `verifierModeId?`,
`verifyPrompt?`, `verifyChecks: string[]`, `archive: boolean`, `sleepMs: number`,
`maxIterations?`, `maxTimeMs?`, `status: running|succeeded|failed|stopped`, timestamps
(`createdAt`/`updatedAt`/`startedAt`/`completedAt?`/`stopRequestedAt?`),
`iterations: LoopIteration[]`, `logs: LoopLogEntry[]`, `nextLogSeq`, `activeIteration?`,
`activeWorkerAgentId?`, `activeVerifierAgentId?`.

Nested:
- `LoopIteration`: `{ index (1-based), workerAgentId?, workerStartedAt, workerCompletedAt?,
  verifierAgentId?, status, workerOutcome?: completed|failed|canceled, failureReason?,
  verifyChecks: LoopVerifyCheckResult[], verifyPrompt?: LoopVerifyPromptResult }`.
- `LoopVerifyCheckResult`: `{ command, exitCode, passed, stdout, stderr, startedAt, completedAt }`.
- `LoopVerifyPromptResult`: `{ passed, reason, verifierAgentId?, startedAt, completedAt }`.
- `LoopLogEntry`: `{ seq (monotonic), timestamp, iteration?, source: loop|worker|verifier|
  verify-check, level: info|error, text }`.

## Behavior & Algorithms

```
function runLoop(rec):
    rec.status = running
    while not stopRequested and within maxIterations/maxTimeMs:
        i = newIteration()
        worker = createAgent(workerProvider||provider, model, modeId, cwd, prompt)
        i.workerAgentId = worker.id
        await worker finishes turn → i.workerOutcome
        if rec.archive: archive worker after use

        passed = true
        for cmd in verifyChecks:
            result = runShell(cmd, cwd); record LoopVerifyCheckResult; passed &&= result.passed
        if verifyPrompt:
            verifier = createAgent(verifierProvider||provider, verifierModel, verifierModeId)
            r = verifier judges against verifyPrompt → LoopVerifyPromptResult
            passed &&= r.passed
        i.status = passed ? succeeded : failed
        if passed: rec.status = succeeded; break
        sleep(sleepMs)
    if stopRequested: rec.status = stopped
    else if not succeeded: rec.status = failed
    rec.completedAt = now
```

- Worker and verifier providers/models can be overridden independently of the loop defaults.
- Logs are appended with a monotonic `seq` so clients page incrementally.
- On daemon startup, loops left `running` are recovered as `stopped` with an interruption log entry.

## Data & Persistence
- `loops/loops.json` — single array, **non-atomic** writes serialized through an in-memory queue.
  See [../architecture/persistence.md](../architecture/persistence.md).

## Error Handling & Edge Cases
| Condition | Expected behavior |
|-----------|-------------------|
| `verifyChecks` command non-zero exit | Iteration fails; loop continues (until cap) |
| Verifier says not passed | Iteration fails; loop continues |
| `maxIterations`/`maxTimeMs` exceeded | `status=failed` (never succeeded) |
| Stop requested | Finish current step gracefully; `status=stopped` |
| Daemon restart mid-run | Recovered as `stopped` + interruption log |
| `archive:true` | Worker agents archived after each iteration |

## Dependencies
- Internal: loop-service, AgentManager, shell execution, verifier agents.
- External: agent providers, shell.

## Acceptance Criteria
- [ ] A loop creates a worker per iteration and records its outcome.
- [ ] All `verifyChecks` must pass and the optional `verifyPrompt` must pass for an iteration to succeed.
- [ ] First successful iteration ends the loop with `status=succeeded`.
- [ ] Exceeding `maxIterations`/`maxTimeMs` ends with `status=failed`.
- [ ] Stop yields `status=stopped` after the current step.
- [ ] Restart recovers a running loop as `stopped` with a log entry.

## TODO(verify)
- [ ] Exact ordering of worker vs. verify steps and whether checks run before or after the LLM verifier.
- [ ] Whether `sleepMs` applies after success or only between failed iterations.
