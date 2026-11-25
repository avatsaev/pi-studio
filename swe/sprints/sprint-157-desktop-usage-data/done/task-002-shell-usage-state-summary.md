# task-002-shell-usage-state — Summary

- **Sprint:** sprint-157-desktop-usage-data
- **Completed:** 2026-11-25
- **Status:** done (orchestrator)

## What was implemented
desktop/crates/shell/src/usage.rs (+ usage/tests.rs): Blocked inputs and order, UsageRun, due rule, once-only close, event body and headers, ID creation, UsageView in boot and ui.inspect, UsageHook in Services; 390 shell tests.

## Build & test results
```
Wave gate (combined tree): cd desktop && cargo fmt --all && cargo xtask ci -> all 8 steps passed
npm run typecheck ok; npx vitest run packages/workbench -> 155 files / 2049 tests passed; npm run lint 0 errors (pre-existing warnings only); fmt:check: none of this sprint's files listed
node --test desktop/apps/pistudiodesktop/scripts/release/usage-token-test.mjs -> pass
```

## Acceptance criteria
- [x] Met as reported by the task's agent and the wave gate. "The web client looks unchanged in a browser" is checked at the sprint-158 live check.
