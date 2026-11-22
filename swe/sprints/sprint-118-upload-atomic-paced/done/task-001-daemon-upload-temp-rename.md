# Task 001 — Daemon: an upload is written to a temporary file and renamed when complete (R3)

- **Sprint:** sprint-118-upload-atomic-paced
- **Status:** done
- **Type:** feature
- **Area:** packages/server/src/files
- **Priority:** P1
- **Estimated size:** M
- **Depends on:** none

## Goal
An upload changes its target only when it has completed; a failed, cancelled or abandoned upload leaves nothing on disk.

## Context / why
Today `Begin` opens the target with `"w"`: the old file is truncated at the first byte and a failed upload leaves half a file. The owner said compatibility does not matter and a better design may break it (spec decision R3, which replaces D14). The wire does not change. Both clients get the new behaviour.

## Scope references
- `swe/features/desktop-transfer-engine.md` § 10 (the table), decision R3, § Error handling & edge cases
- `packages/server/src/files/file-transfer.ts` (`handleUploadFrame`, `finishUpload`, `disposeSession`, `failureText`), `file-transfer.test.ts`
- `packages/protocol/fixtures/external-clients/file_upload_complete.json`, `CHANGELOG.md` and `README.md` there
- Root `AGENTS.md` (§ Protocol overview, the sprint-096 bullet: "A partial file is left after a failed upload"), `packages/server/AGENTS.md`, `swe/features/file-explorer-transfer.md`, `docs/desktop-client-handoff.md` § 2 ("A partial file is left on disk after a failure")

## What to build
- `Begin`: create the target's directory as today, then create `.pistudio-upload-<32 hex>.part` in that directory with an exclusive create. `Chunk`: append to it. `End`: close, rename it over the target, then report success. A failed rename is reported as `rename_failed (<errno>)` through the existing `failureText` shape.
- A client `Error` frame, a failed write or close, and a session that closes (`disposeSession`): close the handle and remove the temporary file. A failed removal is ignored (the upload's reported error stays the original one).
- `bytesWritten` and `file_upload_complete` keep their meaning and shape. `no_begin` is unchanged.
- Documents listed above say what happens now. The fixture's `description` is corrected if it mentions a partial file, with a dated line in the fixtures' `CHANGELOG.md`; no shape changes, so no `formatVersion` bump (regenerate the signature only if the guard asks for it: `npm run fixtures:update -w @av-pi-studio/protocol`).

## Out of scope
- Pacing (task-002).
- Hiding the temporary file from the explorer listing, or removing old ones at daemon start: spec § TODO(verify).
- Upload resume.

## Acceptance criteria
- [ ] Given an upload to a new path, when `End` is handled, then the target exists with the uploaded bytes and no `.pistudio-upload-*.part` remains; before `End` the target does not exist.
- [ ] Given an upload onto an existing file, when it fails (a write error), is ended by a client `Error` frame, or its session closes, then the old file is byte-for-byte unchanged and no temporary file remains.
- [ ] Given a target that cannot be replaced (the target is a directory), then `file_upload_complete` carries `ok: false` with `rename_failed (...)` and no temporary file remains.
- [ ] Given two uploads to the same target at once, both complete and the target holds one of the two files whole, never a mix.
- [ ] The external-fixtures tests (layers A and B) pass; the documents no longer say that a partial file is left.

## Test / verification plan
- `npm run build:server`
- `npx vitest run packages/server/src/files/file-transfer.test.ts packages/server/src/daemon/external-fixtures-e2e.test.ts packages/protocol/src/external-fixtures.test.ts`
- `npx oxfmt <changed .ts files>`; `npm run lint`

## Notes
- The daemon is POSIX-only: a rename over an existing file is atomic there.
- The temporary file is in the target's directory, not in a system temp directory, so the rename never crosses a file system.
- The explorer's file watcher will report the temporary file appearing and disappearing. Say in the summary what the explorer showed.
