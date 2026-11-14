# Task 003 — Upload acknowledgement: fileTransferAck — Summary

- **Sprint:** sprints/sprint-096-desktop-protocol-followups
- **Completed:** 2026-11-14
- **Status:** done

## What was implemented
Protocol: `fileTransferAck` server feature (+COMPAT, test list), `fileUploadCompleteSchema` as a real `sessionMessageSchema` member. Server: `file_upload_request.ack` → one `file_upload_complete` after the file is closed (bytesWritten) or a failure (`<stage>_failed (<errno>)`, client Error message, `no_begin`); nothing without ack or when the session is gone. Decision: a partial file is left on disk after a failure.

## Files created / changed
| File | Change |
|------|--------|
| `packages/protocol/src/{messages.ts,client-capabilities.ts}` | flag + schema |
| `packages/server/src/files/file-transfer.ts` | completion push, failure handling |

## How it satisfies the scope
SDK side deferred to task-004. Chose a real schema for the push even though the rest of the file_* family has none, because the SDK and external clients both branch on `ok`.

## Build & test results
```
Server tests: ok completion with exact bytes visible on disk when the push arrives; zero-byte; no push without ack; open failure (EISDIR) -> `open_failed (EISDIR)`; client Error frame -> ok:false with its message and later frames ignored; schema parse of the push. Full protocol+server+client vitest: 117 files / 1736 tests pass; tsc -b protocol client server clean; oxlint clean on touched files.
```

## Acceptance criteria
['Exactly one ok completion with byte count after close: met.', 'Write failure -> ok:false with error: met (open/EISDIR; write failures share the catch path).', 'No push without ack: met.', '`fileTransferAck` in server_info.features: met (default feature map; dev advertises every key).', 'Docs: met.']

## Follow-ups / TODO(verify)
- file_upload_complete fixture: task-006 (fixtures).
Docs in this task: protocol/client/server/workbench AGENTS + workbench README, root AGENTS protocol overview, desktop-client-handoff.md (status rows, client-type paragraph, transfer facts), the follow-ups spec status + TODO(verify) decisions. The handoff doc now states: platform is accepted by 0.0.117 (checked), invalid hello closes 1008 on direct, upload ack and pacing facts.
