# Task 005 — File download/upload binary transfer

- **Sprint:** sprint-009-terminals-proxy-files
- **Status:** done
- **Estimated size:** S
- **Depends on:** task-004; task-005 (sprint-002, file-transfer frames)

## Goal
Implement chunked file download (token-authorized) and upload over the file-transfer binary frame
format.

## Scope references
- `clean-room-scope/features/file-explorer-transfer.md` § Binary transfer frames, § Behavior (download/upload)
- `clean-room-scope/architecture/websocket-protocol.md` (file-transfer binary router)

## What to build
- Handlers: `FileDownloadTokenRequest` (issue short-lived, single-use token), `FileUploadRequest`.
- Download: client opens a transfer stream with the token → daemon streams file bytes in bounded
  chunks → completion marker.
- Upload: client streams chunks → daemon writes to target path (within allowed authority).
- Register the binary file-transfer router into the frame dispatcher (sprint-004 task-005).

## Out of scope
- Web attachment IndexedDB cache (sprint-012).

## Acceptance criteria
- [ ] Downloading requires a valid token and streams bytes in chunks with a completion marker.
- [ ] An expired/invalid download token is rejected.
- [ ] Uploading writes the streamed file to the target path.
- [ ] Large files transfer via bounded frames.

## Test / verification plan
- Tests: `npx vitest run .../file-transfer.test.ts` — token issue/validate/expire, download round-trip,
  upload write.

## Notes
- Frame layout (opcodes/chunk size/completion marker) + token TTL/single-use are TODO(verify).
