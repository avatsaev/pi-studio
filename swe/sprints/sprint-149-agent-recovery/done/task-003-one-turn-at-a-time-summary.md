# Task 003 — One turn at a time per agent — Summary

- **Sprint:** sprints/sprint-149-agent-recovery
- **Completed:** 2026-11-25
- **Status:** done

## What was implemented
`AgentManager.runExclusive(id, kind, fn)` holds one claim per agent (`turn`, `compaction` or `session`); a second claim throws `busy: agent <id> is running` / `is compacting` / `is changing its session` (router: `rpc_error` `handler_error`). Applied to `send_agent_prompt` and the eager path of create (claim taken before any spawn or resume), compact (replacing the module-local `compactionsInFlight` set), and new session, switch, fork, clone and resume. Model, thinking-level, steer, follow-up, interrupt and reads are not claimed. `handleUpdate` re-reads the record after its awaits before merging, and throws `unknown agent` if it was deleted meanwhile. The compact-on-running message lost its hint text.

## Files changed
`agent-manager.ts`, `agent-service.ts`, `session-operations.ts`, `slash-command-operations.ts` (+ tests: new `one-turn-at-a-time.test.ts`, additions in `agent-manager.test.ts`, updates in `compact-handler.test.ts`); `packages/server/AGENTS.md`, `packages/cli/AGENTS.md`, `swe/features/context-compaction.md`.

## Build & test results
```
$ npx vitest run packages/server packages/cli   -> 144 files, 2165 passed
$ npm run build:server                          -> success
$ Wave gate (full tree, after tasks 002 and 003): `npm run build`, `npm run typecheck`, `npm run lint` all exit 0 (0 errors); `npm test` 326 files, 4682 tests passed (two consecutive runs); oxfmt clean on changed files.
```

## Acceptance criteria
- [x] Two concurrent sends: one turn runs, the other gets `busy`; each event broadcast once
- [x] A send during a compaction gets `busy`
- [x] Fork while running gets `busy` (clone, new session, switch, resume too)

## Follow-ups / TODO(verify)
- CLI `agent send` prints `error: busy: agent X is running (handler_error)` through the existing path (no code change).
- Workbench: a lost race marks the optimistic user row as failed without error text (`Composer.tsx` swallows the rejection); no UI change by the spec.
- `handleResume` is behind the claim by the implementer's decision (it would orphan a live turn otherwise).
- `handleListCommands` and `handleForkMessages` still call `spawnOrResumeSession` without a claim: task-004 (one spawn per agent).
