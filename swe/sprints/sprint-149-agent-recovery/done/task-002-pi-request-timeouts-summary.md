# Task 002 — Requests to Pi time out, and a closed Pi is really stopped — Summary

- **Sprint:** sprints/sprint-149-agent-recovery
- **Completed:** 2026-11-25
- **Status:** done

## What was implemented
In `rpc-transport.ts`: a request with no answer rejects after 60 s with `pi request '<cmd>' timed out after <n> ms` (logged at warn; the process keeps running and a late answer is dropped); `compact` and the slash `prompt` ack get 10 minutes (the ack can wait on an extension dialog). `close()` rejects everything pending (later requests reject too), tree-kills with SIGTERM, SIGKILLs the tree after a 5 s grace, resolves once the process exited, and is safe to call twice. stdout and stderr use `setEncoding("utf8")`. `createProcessTransport(spawnArgs, { requestTimeoutMs, longRequestTimeoutMs, killGraceMs })` takes optional knobs. `topLevel()` needed no change: it closes in `finally`, and the leak was only that the request never rejected.

## Files changed
`packages/server/src/agent/providers/pi/rpc-transport.ts`, new `rpc-transport.test.ts`, `packages/server/AGENTS.md`.

## Build & test results
```
$ npx vitest run packages/server/src/agent/providers/pi   -> 8 files, 162 passed (the new file passed 5 consecutive runs)
$ npm run build:server                                    -> success
$ Wave gate (full tree, after tasks 002 and 003): `npm run build`, `npm run typecheck`, `npm run lint` all exit 0 (0 errors); `npm test` 326 files, 4682 tests passed (two consecutive runs); oxfmt clean on changed files.
```

## Acceptance criteria
- [x] A silent child: `request` rejects after the timeout (fake timers); `compact` only at its longer bound; the process stays alive
- [x] A child ignoring SIGTERM is SIGKILLed after the grace period (real child, 300 ms grace)
- [x] A 4-byte character split across two chunks arrives intact (real child)
- [x] `topLevel`/`listModels` on a silent child rejects and the spawned pid is dead afterwards

## Follow-ups / TODO(verify)
- `AgentManager.closeAll` races each `close()` against 5 s and the transport's SIGKILL grace is also 5 s; task-004 makes the manager's limit longer.
