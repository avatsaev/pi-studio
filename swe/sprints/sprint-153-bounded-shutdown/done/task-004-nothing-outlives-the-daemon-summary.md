# Task 004 — Nothing the daemon started outlives it — Summary

- **Sprint:** sprints/sprint-153-bounded-shutdown
- **Completed:** 2026-11-25
- **Status:** done

## What was implemented
`InstallProcesses` (`extensions/install-processes.ts`) is the production install spawn: it keeps a registry of live children, rejects new ones once stopped, and on `stop()` sends SIGTERM to each process tree and SIGKILL after 2 s. `ExtensionsService` and `ResourceService` own one and gain `close()` (queued or running installs reject with "the daemon is shutting down"); the update pipeline reuses the extensions service's seam, and the update helper is spawned outside it. `TerminalManager.killAll()` is async (SIGTERM, SIGKILL after 2 s, waits for every reaper); `PtyProcess.kill(force?)`. `FileTransferService.close()` ends uploads (handle closed, `.part` removed, journal emptied) and downloads; `ProviderAuthService.close()` aborts every login flow and unrefs TTL timers. New shutdown steps after `terminals`: `installs`, `login flows`, `transfers` (dev: `transfers`). New `util/settles-within.ts`.

## Files changed
New: `extensions/install-processes.ts` (+test), `util/settles-within.ts` (+test), `test-support/process-probe.ts`, `daemon/shutdown-children.test.ts`. Modified: `extensions/{sync-executor,extensions-service}.ts`, `resources/{resource-service,spawn-runner}.ts`, `agent/provider-auth/provider-auth-service.ts`, `files/file-transfer.ts`, `terminal/{terminal-manager,pty-backend,bun-pty-backend}.ts`, `update/binary-update.ts`, `daemon/{bootstrap,dev-bootstrap}.ts`, and their tests; docs: `packages/server/AGENTS.md`, `README.md`.

## Build & test results
```
npx vitest run packages/server -> 125 files, 1729 passed; build:server OK; oxfmt/oxlint clean on 27 files
Process test (a real daemon child with a blocked install and a SIGTERM-trapping shell): 5 of 5 runs pass; with the installs step disabled it fails and lists the leftover processes
npx bun test packages/server/bun-tests/bun-pty-backend.bun_test.ts -> 6 pass
Interim full-tree gate: npm run build, typecheck 0 errors; lint 0 errors; npm test 338 files, 4847 tests passed
```

## Acceptance criteria
- [x] A real `sleep 60` through the install seam is dead after `close()`; queued installs reject
- [x] A terminal whose shell ignores SIGTERM is dead after `killAll()` resolves
- [x] An upload in flight at shutdown leaves no `.pistudio-upload-*.part`
- [x] A real daemon child with an install running and a terminal open exits within the deadline and leaves no process behind
- [x] The update pipeline tests pass (the helper is not killed)

## Follow-ups / TODO(verify)
- The update service's own `npm root -g` / `npm view` / `npm install -g` children (`update/npm.ts`) are not tracked; they have their own timeouts.
- If an install's root process exits but a grandchild ignores SIGTERM, the SIGKILL pass cannot find it (the tree is walked once).
- A Pi killed with SIGKILL still orphans its tool subprocess (out of scope, recorded in M3).
