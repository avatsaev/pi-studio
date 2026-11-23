# Task 002 — Desktop host: `updates` over `boot`, `update_changed` and `engine_command` — Summary

- **Sprint:** sprint-133-desktop-update-ui
- **Completed:** 2026-11-23
- **Status:** done (orchestrator)

## What was implemented
- `src/host/updates.ts`: `parseUpdateState` (strict, unknown or malformed -> `idle`, unknown fields dropped); `createDesktopUpdates(bootState, ipc, log)`: listens for `update_changed`, `check/install/restart` call `engine_command` with `update.check|install|restart` (a refusal rejects with its reason), `subscribe` returns an unsubscribe.
- `boot.ts` reads `boot.update` (missing or bad -> `idle`); `desktop-host.ts` adds `updates`; `ipc.ts` lists the event.

## Files changed
`desktop/apps/pistudiodesktop/src/host/{updates.ts,updates.test.ts,boot.ts,boot.test.ts,desktop-host.ts,ipc.ts}`

## Build & test results
```
Wave gate: cd desktop && cargo fmt --all && cargo xtask ci -> all 8 steps passed; root npm run build, typecheck ok; lint 0 errors; npm test -> 299 files / 4280 tests passed
```

## Acceptance criteria
- [x] every state and a malformed payload; the three ids; listener removal; check, lint, vitest, snapshot pass.

## Follow-ups
- `snapshot.png` was restored after the render; the final snapshot run after lint fixes was not repeated by the agent (the gate's `web` step does not run it).
- oxfmt does not format files under `desktop/` (no target): not formatted by it.
