# Task 003 — Workbench: Settings → Daemon — Summary

- **Sprint:** sprint-137-daemon-update-ui
- **Completed:** 2026-11-23
- **Status:** done (orchestrator)

## What was implemented
- Category present only with the `daemonUpdate` flag: version, install kind, last check, Check now, the automatic-check switch (optimistic, reverts on an error), the update row (opens the dialog); reads the pill's store. `SettingsDialog` no longer dismisses when the update dialog is open on top.

## Files changed
`packages/workbench/src/features/settings/{daemon-settings-view.ts,daemon-settings-actions.ts,DaemonSettingsPanel.tsx,DaemonSettingsPanel.module.css,settings-categories.ts,SettingsDialog.tsx}` (+tests), `AGENTS.md`

## Build & test results
```
Gate (combined tree): npm run build, typecheck ok; lint 0 errors; npm test -> 318 files / 4516 tests passed; cd desktop && cargo fmt --all && cargo xtask ci -> all 8 steps passed
```

## Acceptance criteria
- [x] rows per state, the switch's revert, the category gating; `build:workbench` check-dist ok.

## Follow-ups
None.
