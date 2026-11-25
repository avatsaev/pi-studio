# task-004-app-sender-and-wiring — Summary

- **Sprint:** sprint-157-desktop-usage-data
- **Completed:** 2026-11-25
- **Status:** done (orchestrator)

## What was implemented
src-tauri/src/usage.rs: reqwest/rustls sender, token and endpoint from build env, launch on a background thread, hourly tick and wake, close from RunEvent::Exit and the update restart (2 s); sys-locale (MIT/Apache) in ATTRIBUTION.md; tests against a local server. Follow-up: install's HTTP client constructor is duplicated, not shared; RunEvent::Exit on Restart to update unobserved.

## Build & test results
```
Wave gate (combined tree): cd desktop && cargo fmt --all && cargo xtask ci -> all 8 steps passed
npm run typecheck ok; npx vitest run packages/workbench -> 155 files / 2049 tests passed; npm run lint 0 errors (pre-existing warnings only); fmt:check: none of this sprint's files listed
node --test desktop/apps/pistudiodesktop/scripts/release/usage-token-test.mjs -> pass
```

## Acceptance criteria
- [x] Met as reported by the task's agent and the wave gate. "The web client looks unchanged in a browser" is checked at the sprint-158 live check.
