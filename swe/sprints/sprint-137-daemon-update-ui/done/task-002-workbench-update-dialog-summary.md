# Task 002 — Workbench: the update dialog (confirm with counts, progress, result) — Summary

- **Sprint:** sprint-137-daemon-update-ui
- **Completed:** 2026-11-23
- **Status:** done (orchestrator)

## What was implemented
- `features/daemon-update/`: pure `daemon-update-dialog-view.ts`, `daemon-update-actions.ts` (`startDaemonUpdate`, an `in_progress` refusal re-fetches the status), `daemon-update-shown.ts` (per-daemon marker of the last shown result), `use-update-impact.ts` (agents from the session store, terminals from the daemon list), `DaemonUpdateDialog.tsx` + css, mounted in `ConnectionBar`.
- New optional host member `reloadPage` (browser host only): the Reload button shows only in a browser whose files differ from the daemon's.

## Files changed
`packages/workbench/src/features/daemon-update/*`, `features/connection/ConnectionBar.tsx`, `host/{types.ts,browser-host.ts}`, `AGENTS.md`

## Build & test results
```
Gate (combined tree): npm run build, typecheck ok; lint 0 errors; npm test -> 318 files / 4516 tests passed; cd desktop && cargo fmt --all && cargo xtask ci -> all 8 steps passed
```

## Acceptance criteria
- [x] view tests: confirm 0/0 and N/M, three stages, restarting, updated, rolled back, failed, six cannot_update reasons, reload note on/off; in_progress refusal.
- [ ] The component, the result watcher and the impact hook are untested (no jsdom): seen in 137/t004.

## Follow-ups
- Escape is blocked only on the restarting view.
- A client with no stored marker treats any `lastResult` as unseen.
- A failed state shows a fixed command (the daemon sends none).
