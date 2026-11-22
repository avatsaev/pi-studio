# Task 004 — Live check of the activity lines in the web client, and the documents

- **Sprint:** sprint-119-workbench-transfer-activities
- **Status:** done
- **Type:** test
- **Area:** packages/workbench, packages/web-client, docs
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** task-003

## Goal
The lines, the percentages and Cancel are seen working in a browser against a real daemon, with images for the owner.

## Context / why
There is no DOM test setup: UI behaviour is verified in a browser. The owner looks at the web client before a merge.

## Scope references
- `swe/features/desktop-transfer-engine.md` § 7, § Acceptance criteria (the browser-client row)
- `swe/av-swe.config.json` (`liveChecks`)
- `packages/workbench/AGENTS.md`, `swe/features/file-explorer-transfer.md`

## What to build
- An isolated production daemon and the built web client in headless Chromium: a batch of three uploads (one line, a rising percentage, Cancel during the second file); two large saves at once (two lines, each cancelled or completed); a save of a missing file (the error line); a save from a viewer's toolbar (a line in the explorer, no error on cancel).
- Screenshots of the lines in the light and the dark theme, attached to the summary.
- `packages/workbench/AGENTS.md` gains the invariant (activities, their texts, where a save's line comes from); `swe/features/file-explorer-transfer.md` describes the lines as built.

## Out of scope
- The desktop app's engine (sprint 122).

## Acceptance criteria
- [ ] Every run above is done and reported; a cancelled upload left nothing on the daemon if sprint 118 is built on the branch (say which).
- [ ] The root gates pass: `npm run build && npm run typecheck && npm run lint && npm test`.
- [ ] The summary lists the images the owner should look at.

## Test / verification plan
- `npm run build`; serve `packages/web-client/dist/web`; drive it with the browser tool
- The root gates above

## Notes
- Slow the daemon's reads or use files of several hundred MiB so that a line is visible long enough to cancel.
