# Task 003 — Workbench and desktop host: Update on the Daemons screen; the outdated toast opens it — Summary

- **Sprint:** sprint-138-daemon-update-desktop
- **Completed:** 2026-11-23
- **Status:** done (orchestrator)

## What was implemented
- Daemons screen: Update beside Retry for `cli_outdated` (the npm command stays) and beside Start for `stopped` (local and SSH), a spinner row 'Updating…', and after a failed update 'The update failed' with Update and Retry, the manual command and the last output lines. Host members `daemons.local.update()` / `remote.update()`; `daemons-view.ts` accepts `updating`, `update_failed`, `output`.
- The outdated-daemon toast gains an 'Open Daemons' button; `ui-library` toasts gain an optional `action {label, onSelect}`.

## Files changed
`packages/ui-library/src/{ui/toast.ts,ui/toast.test.ts,primitives/ToastViewport.tsx,primitives/ToastViewport.module.css}`, `packages/ui-library/README.md`, `packages/workbench/src/{host/types.ts,test/test-daemons.ts,features/daemons/*,features/connection/use-outdated-daemon-notice(.ts,.test.ts)}`, `packages/workbench/{AGENTS,README}.md`, `desktop/apps/pistudiodesktop/src/host/{daemons.ts,daemons-view.ts,daemons.test.ts,daemons-view.test.ts}`

## Build & test results
```
Gate: npm run build, typecheck ok; lint 0 errors; npm test -> 318 files / 4536 tests passed; cd desktop && cargo fmt --all && cargo xtask ci -> all 8 steps passed
```

## Acceptance criteria
- [x] view tests for each Update state, host calls and parsing, the toast action; check, lint and snapshot pass.

## Follow-ups
- A refusal as unavailable shows a generic banner (no error code for the reason).
- Not opened in a real webview: 138/t004.
