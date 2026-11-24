# Task 001 — Workbench: the daemon update store and the second pill — Summary

- **Sprint:** sprint-137-daemon-update-ui
- **Completed:** 2026-11-23
- **Status:** done (orchestrator)

## What was implemented
- `daemon-update-store.ts` (status fetched on every connect and fed by the broadcast, cleared on disconnect; a fetch overtaken by a broadcast is dropped), `daemon-update-presentation.ts` (P11 texts/tones, wording helpers), `DaemonUpdateIndicator.tsx`, `use-daemon-update.ts` (`bindDaemonUpdate`, `useDaemonUpdateBoot`), `AppUpdateIndicator.tsx` made a generic pill, `ConnectionBar.tsx` renders the daemon pill before the app's, UI-store flag `daemonUpdateDialogOpen`, `reset-stores`, `WorkbenchBoot`.

## Files changed
`packages/workbench/src/features/connection/*`, `stores/ui-store.ts`, `shell/WorkbenchBoot.tsx`, `test/reset-stores.ts`, `AGENTS.md`

## Build & test results
```
Gate (combined tree): npm run build, typecheck ok; lint 0 errors; npm test -> 318 files / 4516 tests passed; cd desktop && cargo fmt --all && cargo xtask ci -> all 8 steps passed
```

## Acceptance criteria
- [x] presentation tests for every state kind; without the capability nothing is rendered or requested; app-update tests still pass.

## Follow-ups
- The pill hides while reconnecting after `restarting`; the dialog keeps its own state.
