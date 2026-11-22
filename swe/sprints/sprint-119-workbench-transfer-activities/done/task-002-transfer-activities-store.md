# Task 002 — Activities: the store, and uploads and saves that register in it (D8, D11, S8)

- **Sprint:** sprint-119-workbench-transfer-activities
- **Status:** done
- **Type:** feature
- **Area:** packages/workbench/src/stores, src/features/files, src/hooks
- **Priority:** P1
- **Estimated size:** M
- **Depends on:** task-001

## Goal
Every batch of uploads and every save is an activity with a label, a percentage or a state, and a cancel; pure logic, tested without a DOM.

## Context / why
The explorer has one status line and no cancel. Up to three transfers run at once (D7), a batch is one activity and each save its own (D11), and a save can start from three places (S8).

## Scope references
- `swe/features/desktop-transfer-engine.md` § 7 (the table and the texts), decisions D8, D11, S8
- `packages/workbench/src/features/files/upload-sources.ts` (`uploadSources`, `batchPercent`, the status texts), `packages/workbench/src/hooks/use-file-transfer.ts` (`uploadAndRefresh`, `useFileTransfer`)
- `packages/workbench/src/stores/` (the existing stores and their tests, for the pattern)

## What to build
- A store of activities: `{ id, kind: "upload" | "save", label, percent: number | null, state: TransferState, cancel() }`, with add, update and remove; oldest first.
- A pure function from an activity to its line's text, exactly as spec § 7: `Uploading N files… P%`, `Downloading <name>… P%`, `waiting for the connection` for `waiting`, `waiting` for `queued`, no percentage when a size is unknown.
- `uploadSources`: after the overwrite question it registers one activity for the batch and owns one `AbortController`; Cancel aborts the file being sent and starts none of the rest. End texts: `Uploaded N files`, `Upload cancelled`, `Upload failed: <message>`.
- `useFileTransfer().saveToDisk(path)`: calls the host with options; the activity appears at the host's first `onProgress` or `onStateChange` and goes when the call settles. End texts: `Downloaded <name>`, `Download cancelled`, `Download failed: <message>`. A cancel rejects with the `AbortError`, so callers can tell it from a failure.
- Where the end text goes when the explorer is not mounted is this task's decision: keep it in the store as the last result, for task-003 to draw.

## Out of scope
- Drawing (task-003).
- A transfers list, speed, retry (deferred by D8).

## Acceptance criteria
- [ ] Given a batch of three files, when the second is being sent and Cancel is called, then the second upload's signal aborted, the third never started, and the result is `Upload cancelled`.
- [ ] Given a save whose host calls nothing (the user is still in the save dialog), then no activity exists; at the first callback one exists; after the call settles none does.
- [ ] Given `onStateChange("waiting")` then `onProgress(0, total)` (an upload that restarted), then the percentage goes back and the line's text follows.
- [ ] Given two saves and a batch at once, then the store holds three activities, oldest first, each with its own cancel.

## Test / verification plan
- `npx vitest run packages/workbench/src/stores packages/workbench/src/features/files packages/workbench/src/hooks`
- `npm run typecheck`; `npm run lint`; `npx oxfmt <changed files>`

## Notes
- No jsdom here: keep every decision in pure modules.
- The percentage of a batch counts whole files already sent plus the current one, as `batchPercent` does today.
