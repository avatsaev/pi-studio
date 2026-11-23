# Task 003 — The update engine moves to the server; install kind — Summary

- **Sprint:** sprint-135-daemon-update-foundation
- **Completed:** 2026-11-23
- **Status:** done (orchestrator)

## What was implemented
- `packages/server/src/update/{npm.ts,install-kind.ts,index.ts}` (+ tests): `npmLatestVersion`, `compareVersions`, `npmGlobalInstall` with the ENOTEMPTY retry (moved from the CLI), `detectInstallKind(env, selfUrl, npmRoot, fs?)`, `npmRootGlobal` (cached), `canWriteGlobalFolder(folder)`, `npmOnPath`, `updateBlocker(kind, platform)`.
- `PACKAGE_NAME` in `version.ts`; the CLI's `update-control.ts` keeps its `UpdateRuntime` seam over the server engine; `docker/daemon.Dockerfile` sets `PI_STUDIO_INSTALL_KIND=docker`.

## Files changed
`packages/server/src/{update/*,version.ts,index.ts}`, `packages/cli/src/{update-control.ts,update-control.test.ts}`, `docker/daemon.Dockerfile`, docs

## Build & test results
```
Wave gate (combined tree): npm run build, typecheck ok; lint 0 errors; npm test -> 304 files / 4318 tests passed; cd desktop && cargo xtask ci -> all 8 steps passed
```

## Acceptance criteria
- [x] four kinds + env + blockers; `update --check` tests unchanged; a test greps the Dockerfile.

## Follow-ups
- `detectInstallKind` and `npmRootGlobal` are async (they spawn npm).
- `updateBlocker` returns only `unsupported_platform`: the service (136/t003) must apply `npm_missing` (`npmOnPath`) and `not_writable` (`canWriteGlobalFolder`) in the spec's order.
- `npmGlobalInstaller` renamed `npmGlobalInstall`.
