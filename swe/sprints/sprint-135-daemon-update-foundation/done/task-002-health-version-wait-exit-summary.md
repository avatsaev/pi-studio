# Task 002 — `/api/health` carries the version; stop and restart wait for the exit — Summary

- **Sprint:** sprint-135-daemon-update-foundation
- **Completed:** 2026-11-23
- **Status:** done (orchestrator)

## What was implemented
- `/api/health` -> `{status, version}`; fixture `health.json` gets `version` (additive, a volatile leaf; signatures regenerated, changelog entry).
- `waitForProcessExit(pid, {timeoutMs, pollMs, alive?})` (`packages/server/src/update/process-wait.ts`, exported).
- CLI: `stopDaemon` async, SIGTERM then waits 10 s, returns `{stopped, error?: "still_running"}`; a stale PID file is removed; `DaemonRuntime.waitForExit`; `daemon restart` stops, waits, starts, never reports the stopped process as already running; when it cannot stop it prints `{up:false, host, port, error:"still_running"}` and exits 1; `rotate-key` aborts on `still_running`.
- Desktop parser checked (read only): the added `error` is ignored, `stopped:false` maps to `Stopped`.

## Files changed
`packages/server/src/{http/http-server.ts(+test),update/process-wait.ts(+test),update/index.ts}`, `packages/cli/src/{daemon-control.ts,daemon-commands.ts,daemon-commands.test.ts,auth-commands.test.ts,program.test.ts}`, `packages/protocol/fixtures/external-clients/{health.json,CHANGELOG.md,.signatures.json}`, docs

## Build & test results
```
Wave gate (combined tree): npm run build, typecheck ok; lint 0 errors; npm test -> 304 files / 4318 tests passed; cd desktop && cargo xtask ci -> all 8 steps passed
```

## Acceptance criteria
- [x] health test; waitForProcessExit with a fake `alive`; restart waits (fake clock 300 ms); live: 20 restarts on a scratch home gave 20 new PIDs with the old PID dead each time, health afterwards `{status:ok,version:0.0.129}`, stop removed the PID file.

## Follow-ups
- The spec's extra check (a reused PID that is not `node`) is not implemented.
- `daemon stop` without `--json` prints `still_running` on stderr and exits 1.
