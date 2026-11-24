# Task 004 — `pi-studio update` restarts a running local daemon — Summary

- **Sprint:** sprint-135-daemon-update-foundation
- **Completed:** 2026-11-23
- **Status:** done (orchestrator)

## What was implemented
- After a real install (and the extensions step), a running local daemon is stopped (waiting for the exit) and started again on the same `host:port`; prints `daemon restarted: <version>` (version read from `/api/health`); a failed restart prints the reason and exits 1, the install stays. Not run when the CLI was already current. `update --check` unchanged.
- New required `DaemonRuntime.readVersion(host, port)` seam (HTTP default).

## Files changed
`packages/cli/src/{update-commands.ts,update-commands.test.ts,daemon-control.ts,auth-commands.test.ts,daemon-commands.test.ts,program.test.ts}`, `packages/cli/{README,AGENTS}.md`, `fern/pages/cli/overview.mdx`

## Build & test results
```
Gate (combined tree): npm run build, typecheck ok; lint 0 errors; npm test -> 318 files / 4516 tests passed; cd desktop && cargo fmt --all && cargo xtask ci -> all 8 steps passed
```

## Acceptance criteria
- [x] running -> restarted on the same address; not running -> not started; install failed -> no restart; failed restart exits 1.

## Follow-ups
- `restartLocalDaemon` resolves its home itself (duplicates a private helper of `daemon-commands.ts`).
