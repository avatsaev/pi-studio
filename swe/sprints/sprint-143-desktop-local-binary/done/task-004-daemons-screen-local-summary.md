# Task 004 — The Daemons screen's local row — Summary

- **Sprint:** sprint-143-desktop-local-binary
- **Completed:** 2026-11-24
- **Status:** done

## What was built
Plain-words labels in the pure modules: "Downloading the daemon · 42 %" (floored, capped at 100, omitted when total is 0), "Installing the daemon", "The download failed", "The file did not match its checksum and was deleted", "Installing the daemon failed" (last ≤8 lines / 600 characters via `truncateOutput`; the SSH `update_failed` output uses it too), `spawn_failed` "The daemon could not be run", `bad_output` "The daemon printed something unexpected". Every `failed` reason offers only Retry (`local.start()` installs the pin first); `outdated` offers Update and Retry (probe) with a notice. The page also connects when a local daemon goes `downloading`/`installing` → `running` while idle. The daemon switcher reuses the labels (Retry for failed/outdated; none for downloading/installing). `test-daemons.ts` treats downloading/installing as busy. Host parse and removal of the CLI-missing view and `cliPath` were already done in 143/001; a desktop host test checks every local state parses as the app serializes it.

## Results
`npx vitest run packages/workbench` 1954; desktop frontend `npm test` 322; `npx tsc -b --force` clean; `npm run check`/`lint` clean; oxfmt/oxlint clean on touched files.

## Acceptance
- [x] Presentation and host tests for every state; no `cliPath` left in the workbench or desktop frontend (remaining `cli_outdated`/`cli_missing` strings are the SSH remote's or tests asserting rejection).

## Follow-ups
`daemons.local.pin()` (page shows the pin) needs a Rust command first; Update on `stopped` is redundant but harmless; the look of the row is for 145/001.
