# Task 005 — Daemon: remove upload temporary files a killed daemon left — Summary

- **Sprint:** sprints/sprint-123-desktop-transfer-engine-close
- **Completed:** 2026-11-22
- **Status:** done (orchestrator)

## What was implemented
- `packages/server/src/files/upload-journal.ts`: `UploadJournal` over `$PI_STUDIO_HOME/pending-uploads.json` (`{version: 1, files: [...]}`, written with `atomicWriteJson`, one write at a time). `add` lists a file before it is created; `remove` drops it. At construction it removes every listed file that is absolute and whose basename matches `UPLOAD_TEMP_NAME` (`.pistudio-upload-<32 hex>.part`), then the journal; `swept` resolves with the count. A journal that cannot be read or written only loses the cleanup.
- `FileTransferService`: `deps.uploadJournal`; `Begin` awaits `add` before the exclusive create (and removes the entry if the create fails); a successful rename and every discard drop the entry.
- Production bootstrap: one journal, a log line `removed upload files left by an earlier daemon` with the count when it is above 0. Dev daemon: none.
- Also in this change: `minDaemonVersion` raised to 0.0.127. `main` published 0.0.126 from the code this branch started from, so 0.0.126 lacks the daemon changes; this branch's merge publishes 0.0.127.

## Files changed
`packages/server/src/files/upload-journal.ts` (new), `upload-journal.test.ts` (new), `file-transfer.ts`, `packages/server/src/daemon/bootstrap.ts`; docs: root `AGENTS.md`, `packages/server/AGENTS.md`, `desktop/AGENTS.md`, `docs/desktop-client-handoff.md`, `swe/MAIN-SCOPE.md`, the spec, `PLAN.md`. Version: `desktop/crates/shell/src/cli_answers.rs` and the three tests naming it, `desktop/docs/architecture.md`, `swe/features/desktop-daemon-registry.md`, the macOS check script's comment.

## Build & test results
```
npm run build:server -> ok
npx vitest run packages/server/src/files -> 5 files, 118 tests passed (4 new); the new file 3 runs in a row
live: isolated daemon, an upload stalled at 3 s, kill -9: the .part file stayed; restart: the file was gone, no journal left, log "removed upload files left by an earlier daemon" removed: 1
```

## Acceptance criteria
- [x] A listed file is removed at start; another name or a relative path is not.
- [x] A journal that is not JSON is removed and the daemon carries on.
- [x] While an upload runs its file is listed; after `End` it is not.
- [x] Live: kill -9 mid-upload, restart, file removed.

## Follow-ups
- The explorer still lists the file while an upload runs (not hidden, by the owner's choice of cleanup only).
