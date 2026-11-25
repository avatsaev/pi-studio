# Task 002 — CLI: `run`, `send` and `wait` follow events — Summary

- **Sprint:** sprints/sprint-152-instant-replies-clients
- **Completed:** 2026-11-25
- **Status:** done

## What was implemented
`agent run` and `agent send` print the agent id on stdout as soon as the daemon accepts, then wait with the SDK's `waitForAgentIdle` (`--no-wait` returns after the accept with exit 0). Exit 0 only for `idle`; `error`, `closed`, timeout, Ctrl-C and a lost connection exit 1. On `error` stderr carries the last `turn_failed` reason seen on the connection (the tracker is installed before the request). `--json` prints one compact line at the end: `{agentId,status,error?}`, `{agentId}` with `--no-wait`, `{agentId,error:"timeout"}`, `{agentId,error:"interrupted"}`. `--timeout <seconds>` (run, send, wait): the turn keeps running when it expires. Ctrl-C ends the wait only and says so. `agent wait` uses the same wait (`AGENT_RPC.wait`, which no daemon handler ever served, is gone). `attach --until-idle` exits 1 on `turn_failed`. A refused send still prints the daemon's error and exits 1. Beyond the task, at sprint-152/task-004's request, the CLI now uses the SDK's named timeouts (`SESSION_START_TIMEOUT_MS`, `PI_COMMAND_TIMEOUT_MS`, `WORKTREE_TIMEOUT_MS`, `EXTENSION_PACKS_SYNC_TIMEOUT_MS`) and `featureRpc` takes an optional `timeoutMs`.

## Files changed
`packages/cli/src/{agent-commands,output,feature-commands,extensions-commands}.ts` and tests (`agent-commands.test.ts`, `program.test.ts`, feature and extensions tests); docs `packages/cli/AGENTS.md`, `README.md`, `fern/pages/cli/agent.mdx`.

## Build & test results
```
npx vitest run packages/cli -> 31 files, 642 passed; build:cli OK; oxfmt/oxlint clean
Full-tree gate: build, typecheck 0 errors; lint 0 errors; npm test (two runs) 341 files, 4944 tests passed
Live, against the built dev daemon with the mock provider on spare ports: run printed the id at 0.37 s and exited 0 at 2.88 s; #stream fail exited 1 with "mock turn failure" on stderr; --no-wait returned in 0.35 s; send while running printed "busy: agent ... is running" and exited 1; wait on a running agent returned idle at 2.87 s; --timeout 1 exited 1 after 1.35 s; Ctrl-C exited 1 with "the turn keeps running"; attach --until-idle on a failed turn exited 1; every --json case printed exactly one line
```

## Acceptance criteria
- [x] `run` prints the id before the turn ends and exits after it
- [x] A failed turn gives a non-zero exit, the reason on stderr and `status: "error"` in JSON
- [x] `--no-wait` returns at once with exit 0
- [x] `wait` on an idle agent returns at once; on a running one when the turn ends
- [x] `--json` prints exactly one line in every case

## Follow-ups / TODO(verify)
- `send` now prints the agent id instead of `sent`.
- Not checked against a real Pi (sprint-152/task-005).
