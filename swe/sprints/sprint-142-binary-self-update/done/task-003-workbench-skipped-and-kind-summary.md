# Task 003 — Workbench: the skipped version and the `binary` kind — Summary

- **Sprint:** sprint-142-binary-self-update
- **Completed:** 2026-11-24
- **Status:** done

## What was built
`daemon-update-presentation.ts` (own wording for `unmanaged_binary`), `daemon-settings-view.ts` ("Single binary"; `skipped`/`skippedText`: "X was rolled back and is not offered; Check now to try it again."), `daemon-update-dialog-view.ts` (`link`, `isWebAddress`), `DaemonSettingsPanel.tsx`, `DaemonUpdateDialog.tsx` ("Open the release page" above the copyable command). Existing styles reused (no CSS). Pure-logic tests added; `packages/workbench/AGENTS.md`.

## Results
`npx vitest run packages/workbench` 1949 passed; `tsc -b` clean; oxfmt/oxlint clean.

## Acceptance
- [x] Lines and dialog for the new kind/reason/skip. [ ] **Not shown in a browser**: no visual check was made.
