# Task 005 — Browser host: upload without reading the file into memory

- **Sprint:** sprint-096-desktop-protocol-followups
- **Status:** backlog
- **Type:** feature
- **Area:** packages/workbench (host, files)
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** task-004, sprint-093

## Goal
Make the browser host's upload pass the `File` itself to the SDK, and show progress.

## Context / why
This is where the browser client stops holding a whole upload in memory, which is the limit users actually hit.

## Scope references
- `swe/features/desktop-client-protocol-followups.md` § Web client
- `swe/architecture/workbench-host-adapter.md` § Member contracts (`files.upload`)
- `packages/workbench/src/host/` (browser host `files.upload`)
- `packages/workbench/src/hooks/use-file-transfer.ts`
- `packages/workbench/src/features/files/FileExplorer.tsx` (status line)

## What to build
- Browser host `files.upload`: pass the `File` (a `Blob`) as the SDK upload source; no `arrayBuffer()` call.
- Extend the host's upload contract with optional progress and cancel if the explorer needs them to show progress; the explorer's status line shows a percentage while uploading.
- Update the host spec's `files.upload` row: with the acknowledgement, the promise now means daemon-confirmed.
- Tests: the browser host hands the SDK a `Blob`, not bytes; progress reaches the status line; a rejected upload shows the daemon's error.
- Keep `docs/desktop-client-handoff.md` current: update whatever this task makes stale there (status table, workbench and host sections, wire facts, milestones, open questions). Say in the summary what changed in it, or that nothing did.

## Out of scope
- Download streaming in the browser.

## Acceptance criteria
- [ ] Uploading a file larger than 500 MB from `web-client` completes, the file appears in the Files tree with the right size, and the tab's memory does not grow by the file size.
- [ ] A failed upload shows the daemon's error in the status line.
- [ ] Small uploads behave as before.
- [ ] `docs/desktop-client-handoff.md` matches the repository after this task, or the summary states that nothing in it was affected.

## Test / verification plan
- `npx vitest run packages/workbench/src/host packages/workbench/src/hooks`
- Browser check against a production daemon: upload a file of at least 500 MB while watching the tab's memory; compare checksums on both sides.

## Notes
- Create the large test file with `truncate -s 600M` or `dd`; remove it from both sides afterwards.
