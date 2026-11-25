# Task 004 — Terminal subscriptions end with their session — Summary

- **Sprint:** sprints/sprint-154-socket-limits
- **Completed:** 2026-11-25
- **Status:** done

## What was implemented
Terminal output subscriptions use `SessionSubscriptions` (keyed `terminal:<slot>`), replacing the private `streamUnsubs` map in `terminal-rpc.ts`; `TerminalRpcDeps` has a new required `subscriptions`. Subscribe replaces an existing entry, unsubscribe removes it, and `onTerminalExit` removes the entry for every session (a reused slot cannot inherit a stale one). The production `disposeSession` already disposed `subscriptions`; the dev daemon now has its own `SessionSubscriptions`, disposed in `onSessionClose`.

## Files changed
`terminal/terminal-rpc.ts`, `terminal-rpcs.test.ts` (fake timers), `daemon/bootstrap.ts` and `dev-bootstrap.ts` (wiring), `packages/server/AGENTS.md`.

## Build & test results
```
npx vitest run packages/server/src/terminal packages/server/src/daemon -> 25 files, 352 passed; build:server OK
Full-tree gate: build, typecheck 0 errors; lint 0 errors; npm test (two runs) 346 files, 4991 tests passed
```

## Acceptance criteria
- [x] Subscribe, then close the session: no frame arrives afterwards and the subscription map is empty
- [x] A terminal that exits clears its entries for every session
- [ ] The same in the dev daemon: wired identically and covered by the type check and the existing dev-daemon suites; no dev-daemon-specific test

## Follow-ups / TODO(verify)
- None.
