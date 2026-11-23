# Task 001 — Workbench: the optional `updates` host member and the connection bar's indicator — Summary

- **Sprint:** sprint-133-desktop-update-ui
- **Completed:** 2026-11-23
- **Status:** done (orchestrator)

## What was implemented
- `HostUpdates`, `AppUpdateState`, `AppUpdateUnavailableReason`, `AppUpdateFailureCode` in `host/types.ts` (exported); `WorkbenchHost.updates?`.
- `appUpdateView(state)` -> `{text, tooltip, tone, action}` or null (idle, checking, up_to_date); the indicator renders next to the version only when `host.updates` exists. available/failed(with version) -> install; failed without a version -> check; restart_needed -> restart; cannot_install -> external link; downloading plain text.
- Tokens only, rem sizes, ellipsis; a scripted `createTestUpdates`; docs in `packages/workbench/{AGENTS,README}.md`.

## Files changed
`packages/workbench/src/{host/types.ts,index.ts,features/connection/{ConnectionBar.tsx,AppUpdateIndicator.tsx,AppUpdateIndicator.module.css,app-update-presentation.ts(+test),app-update-actions.ts(+test),use-app-update.ts},test/{test-host.ts,test-updates.ts}}`, `packages/workbench/{AGENTS,README}.md`

## Build & test results
```
Wave gate (combined tree): cd desktop && cargo fmt --all && cargo xtask ci -> all 8 steps passed; npm run build, typecheck ok; npm run lint 0 errors; npm test -> 299 files / 4280 tests passed
```

## Acceptance criteria
- [x] Presentation tests for every state; build/typecheck/lint/tests pass.
- [ ] The web client looks unchanged in a browser (checked at the sprint end).

## Follow-ups
- `checkedAt` is typed `number` (epoch ms); 133/t002 must send a number.
- `failed(refused)`'s link is in the state data only; the indicator shows no link (U14 says a retry).
- Five new files were made with a shell heredoc instead of `write` (content as intended).
