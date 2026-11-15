# Task 003 — Daemon: download validator, per-session tracking, cancel — Summary

- **Sprint:** sprints/sprint-097-download-ranges
- **Completed:** 2026-11-15
- **Status:** done

## What was implemented
In `packages/server/src/files/file-transfer.ts`:
- **`ifUnchanged`**: `{ size, mtimeMs }` compared with the opened file's size and truncated `mtimeMs`; a mismatch (or a value that is not that shape) answers `changed` with the current `totalBytes` and `mtimeMs`, no binary frame.
- **Tracking**: `downloads: Map<sessionId, Map<stream, ActiveDownload>>`. The stream id is checked and reserved synchronously, from acceptance until `End`/`Error`/close; `stream_in_use` is returned for a busy id of the same session, another session may use the same id. A request without `stream` gets the next free id on its session; all 256 busy answers `no_free_stream`.
- **Cancel**: `file_download_cancel_request { stream }` → `file_download_cancel_response { ok: true }` or `{ ok: false, error: "not_found" }`. `cancelDownload` marks the download stopped and wakes the read loop (also while it is paused on a slow socket); the stream sends one `Error` `cancelled` and reads no further. A cancel that arrives before the stream started sends only the `Error`.
- **Session close**: `disposeSession` also stops the session's downloads and closes their handles; nothing is sent.
- The short-read `Error changed` and "file that grows sends only `length`" were already in place from task-002; this task added the tests for the grow case.

## Files created / changed
| File | Change |
|------|--------|
| `packages/server/src/files/file-transfer.ts` | tracking, validator, cancel, dispose, `beginDownload(sessionId, message)` |
| `packages/server/src/files/file-transfer.test.ts` | 14 new tests (validator, grow, stream ids, no_free_stream, cancel incl. read-count assertion, paused cancel, early cancel, router cancel RPC, session close with fd counts) |
| `packages/server/AGENTS.md` | lifecycle paragraph |
| `swe/features/desktop-client-protocol-followups-2.md` | error table: `no_free_stream`; `changed` for a malformed validator |

## How it satisfies the scope
Follow-ups II § 1.1, § 1.2, § 1.4 and the Download (daemon) pseudocode. Decisions recorded: `no_free_stream` (the uploads' code) for an exhausted session; a malformed `ifUnchanged` is `changed`, not a new error. `beginDownload` now takes the session id as its first argument (it is internal; the handler passes `ctx.session.id`).

## Build & test results
```
$ npm run build:server
success

$ npx vitest run packages/server/src/files packages/server/src/daemon/external-fixtures-e2e.test.ts packages/server/src/daemon/bootstrap.test.ts packages/server/src/ws
Test Files  9 passed (9) / Tests  266 passed (266)

$ npx oxlint packages/server/src/files; npx oxfmt --check <changed files>
clean
```

## Acceptance criteria
- [x] `ifUnchanged` current → served; stale → `changed` with current values, no frame ("ifUnchanged" tests).
- [x] Truncated file → `Error changed` (task-002 test); grown file sends only `length` (grow test).
- [x] `stream_in_use` for the same session, accepted on another session, reusable after `End` (stream-id test).
- [x] No `stream` → free id on the session (test).
- [x] Cancel: `ok: true`, `Error cancelled`, no further read (read-spy assertion: reads at most 2 beyond the count at cancel, out of ~1000 chunks); paused downloads cancel too.
- [x] Cancel after `End` / unknown / another session's stream → `not_found`.
- [x] Session close mid-download and before start leaves no tracked download and no open fd (`/proc/self/fd` counts; Linux only).
- [x] Uploads and every existing transfer test unchanged and passing.

## Follow-ups / TODO(verify)
- `file_download_response.json`'s `description` still lists only the task-002 errors; task-005 adds the rejection fixtures and refreshes it.
- Session-close fd assertions use `/proc/self/fd`, so they skip on non-Linux CI.
