# Task 005 — File download/upload binary transfer — Summary

- **Sprint:** sprint-009-terminals-proxy-files
- **Completed:** 2026-06-11
- **Status:** done

## What was implemented
`packages/server/src/files/`:
- **`download-token-store.ts`** — `DownloadTokenStore`: `issue(path)` → single-use token + expiry;
  `consume(token)` validates (rejects unknown/expired/reused) and consumes. Injectable clock; 60s
  default TTL (TODO(verify)).
- **`file-transfer.ts`** — `FileTransferService`:
  - `file_download_token_request` → resolves the path + issues a token; `issueDownloadToken()` is
    also handed to the file explorer (task-004) for binary previews.
  - `file_download_request` → `startDownload(token, stream, sink)`: consumes the token then streams
    the file as `Begin → Chunk* → End` file-transfer binary frames (bounded 32KiB chunks via a read
    stream); rejects invalid/expired tokens.
  - `file_upload_request` → registers a target path keyed by an assigned `stream`; the returned
    `binaryHandler()` consumes incoming `Begin → Chunk* → End` frames and writes them to the target
    (creating parent dirs). **Upload frames are serialized per stream** so an in-flight `Begin`
    (open) completes before any `Chunk` writes.
  - Uses the sprint-002 `encode/tryDecodeFileTransferFrame` codec.

## Files created / changed
| File | Change |
|------|--------|
| `packages/server/src/files/download-token-store.ts` | created |
| `packages/server/src/files/file-transfer.ts` | created |
| `packages/server/src/files/index.ts` | modified (re-exports) |
| `packages/server/src/files/file-transfer.test.ts` | added — 4 tests (real temp fs) |

## Build & test results
```
$ npm run build:server                                            → exit 0
$ npx vitest run packages/server/src/files/file-transfer.test.ts  → 4 passed
$ npx vitest run packages/server/src/files/                       → 9 passed (2 files)
$ npx oxlint / oxfmt --check packages/server/src/files             → clean
```

## Acceptance criteria
- [x] Downloading requires a valid token and streams bytes in chunks (Begin → Chunk* → End,
      verified > 1 chunk for a 100 KB file + content reassembly).
- [x] Expired/invalid/reused download tokens are rejected.
- [x] Uploading writes the streamed file to the target path (parent dirs created).
- [x] Large files transfer via bounded frames (32 KiB chunk size).

## Follow-ups / TODO(verify)
- Exact download-token TTL/single-use semantics + frame chunk sizing (modeled 60s / 32 KiB).
- Composing terminal + file-transfer binary handlers in the daemon frame dispatcher (by opcode
  range) is a bootstrap integration step.
