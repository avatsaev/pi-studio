# Task 001 — Daemon upload temp file + rename — Summary

- **Sprint:** sprints/sprint-118-upload-atomic-paced
- **Status:** done (ready to move)

## What was implemented
- `Begin` creates `.pistudio-upload-<32 hex>.part` beside the target with an exclusive create (`"wx"`).
- `Chunk` appends to the temp file.
- `End` closes it and renames it over the target, then reports. A failed rename reports `rename_failed (<errno>)`.
- A client `Error` frame, a failed write or close, and `disposeSession` close the handle and remove the temp file. A failed removal is ignored.
- `bytesWritten`, the `file_upload_complete` shape and `no_begin` are unchanged. The wire is unchanged.

## Files changed
| File | Change |
|---|---|
| `packages/server/src/files/file-transfer.ts` | modified: `tempPath` on `PendingUpload`, `discardTemp`, new Begin/End/Error/catch/dispose paths |
| `packages/server/src/files/file-transfer.test.ts` | modified: three existing tests updated, five atomic-upload tests added |
| `packages/server/AGENTS.md`, `AGENTS.md`, `packages/protocol/AGENTS.md`, `docs/desktop-client-handoff.md`, `swe/features/file-explorer-transfer.md` | docs now describe the atomic upload instead of "partial file left" |

- The fixture `file_upload_complete.json` never mentioned a partial file, so I left it alone. I made no `CHANGELOG.md` entry and no signature change.
- `packages/protocol/AGENTS.md` is not in the task's doc list. Its table row said "A partial file is left", so I corrected it.

## Build & test results
```
$ npm run build:server                     → success
$ npx vitest run file-transfer.test.ts external-fixtures-e2e.test.ts external-fixtures.test.ts
  3 files passed, 242 tests passed, 0 failed
$ npx oxfmt <2 changed .ts files>          → clean
$ npm run lint                             → no errors; none in the changed files
```

## Acceptance criteria
- [x] New path: the target is absent before `End`, holds the bytes after, and no `.part` remains. Test: "creates the target only at End…".
- [x] Existing file: the old bytes are unchanged and no temp file remains after a failed write (the temp file removed under the service, so the rename fails), after an `Error` frame, and after session close. Three tests cover these.
- [x] Target is a directory: `ok:false`, `rename_failed (EISDIR)`, no temp file. Test: "reports a target that is a directory as rename_failed…".
- [x] Two concurrent uploads to the same target both complete, and the target holds one of the two files whole.
- [x] External-fixtures layers A and B pass, and the docs no longer say a partial file is left.

## Follow-ups / TODO(verify)
- **Explorer behaviour:** I did not run the explorer. By design the watcher will report the `.part` file appearing and disappearing, since it is not hidden (out of scope per the task). Not verified live.
- **Write-error test:** the test makes the final rename fail (temp file deleted mid-upload), not a failing `write()`. Both go through the same catch path, which removes the temp file.
- **Existing tests:** I changed three existing tests because they assumed the target exists mid-upload or that a partial file is left.
- **Pacing:** not touched (task-002).

## Wave gate (orchestrator, combined tree)
```
npm run build -> ok; npm run typecheck -> ok; npm run lint -> 0 errors; npm test -> 292 files, 4159 tests passed
npm run fmt:check -> 28 files flagged, all pre-existing and none changed by this wave
cargo xtask ci (desktop/) -> all 8 steps passed (fmt, web, clippy, layers, test, panic_hunt, doctest, wasm)
```
