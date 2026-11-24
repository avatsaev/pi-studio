# Task 001 — Shutdown closes agent sessions and removes the PID file — Summary

- **Sprint:** sprint-135-daemon-update-foundation
- **Completed:** 2026-11-23
- **Status:** done (orchestrator)

## What was implemented
- `AgentManager.closeAll(timeoutMs = 5000)`: every live session closed at once, each raced against the limit; a failure or timeout is logged and the rest go on; a second call does nothing.
- `startDaemon().close()` is memoized; order: `closeAll`, then the existing steps, then `removePidLock` (removes `pi-studio.pid` only when it holds this process's PID). The dev daemon's `close()` calls `closeAll` first.
- Finding (real daemon + real `pi --mode rpc`, no credential needed): after SIGKILL of the daemon the `pi` child exited by itself within 1 s, so an idle or stuck turn leaves no orphan; grandchildren of a long tool call not tested [INFERENCE].

## Files changed
`packages/server/src/{agent/agent-manager.ts,agent/agent-manager.test.ts,daemon/bootstrap.ts,daemon/dev-bootstrap.ts,daemon/shutdown.test.ts}`, `packages/server/{AGENTS,README}.md`, root `AGENTS.md`

## Build & test results
```
Wave gate (combined tree): npm run build, typecheck ok; lint 0 errors; npm test -> 304 files / 4318 tests passed; cd desktop && cargo xtask ci -> all 8 steps passed
```

## Acceptance criteria
- [x] mock agent + terminal: closed in order, PID file gone; a hung close is bounded at 5 s; a foreign PID file is left; SIGKILL experiment recorded.

## Follow-ups
- The process-tree kill is the Pi transport's own `close()`; the manager's 5 s limit bounds a provider that hangs.
- The EADDRINUSE path calls only `wsHandle.close()`: `writePidLock` has already overwritten the live daemon's PID file there (existing behaviour, left alone).
- The spec's TODO (do children exit when the daemon dies?) is answered: yes for an idle child.
