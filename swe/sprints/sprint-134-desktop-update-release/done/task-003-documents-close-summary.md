# Task 003 — Documents and spec close for the app's self-update — Summary

- **Sprint:** sprint-134-desktop-update-release
- **Completed:** 2026-11-23
- **Status:** done (orchestrator)

## What was implemented
- `desktop/docs/development.md` (the key's runbook, releasing, the update check, the real-webview recipe), `docs/architecture.md`, `docs/control-protocol.md`, `desktop/AGENTS.md` (milestone 5 paragraph), root `AGENTS.md`, `packages/workbench/{AGENTS,README}.md` (from 133/t001), `swe/architecture/workbench-host-adapter.md` (the `updates` row: built), `swe/features/desktop-self-update.md` (status; U6 corrected: second signature; § 6: the control port retry; the `refused` row: the click opens the release page; ticks of what was seen; TODO(verify) resolved and the open ones named), `docs/desktop-client-handoff.md` (milestone 5 state), `swe/sprints/PLAN.md` close note.
- The release notes in `desktop-release.yml` already say the app updates itself.

## Files changed
`desktop/AGENTS.md`, `AGENTS.md`, `swe/features/desktop-self-update.md`, `swe/architecture/workbench-host-adapter.md`, `docs/desktop-client-handoff.md`, `swe/sprints/PLAN.md`

## Build & test results
```
Gate on the final tree: cd desktop && cargo fmt --all && cargo xtask ci -> all 8 steps passed; root npm run build, typecheck ok; lint 0 errors; npm test -> 299 files / 4281 tests passed; PR #65 run 45278838906: gate, Version, Bundle x3, Update check x3 succeeded, Bundle for release / Release / Promote skipped
```

## Acceptance criteria
- [x] No document states that the app cannot update itself outside history (grep reviewed).
- [x] The release notes mention that the app updates itself.

## Follow-ups
- The first publishing-run ticks of the spec stay open until after the merge (t004).
