# Task 002 — Daemon: download by path, ranged and sized, answered before the stream; token removed — Summary

- **Sprint:** sprints/sprint-097-download-ranges
- **Completed:** 2026-11-15
- **Status:** done

## What was implemented
`file_download_request { path, stream?, offset?, length? }` replaces the token flow. `FileTransferService.beginDownload(message)` validates the request, opens the file and returns `{ response, run? }`; the handler returns `response` and schedules `run` through a new `ctx.afterReply(fn)` hook on the router, so the reply is always sent before `Begin`. The reply and `Begin` carry `totalBytes`, `mtimeMs` (integer), `offset`, `length` (clamped). Rejections (`missing_path`, `not_found`, `not_a_file`, `unreadable`, `invalid_stream`, `invalid_range`, `range_not_satisfiable`) answer with no binary frame. A file that ends before `length` bytes sends one `Error` frame `changed`. `run` never rejects and always closes the file handle.

Removed: `file_download_token_request`, `DownloadTokenStore` (file deleted), `issueDownloadToken`, `invalid_or_expired_token`, `transferToken` on the explorer's binary preview, the `issueDownloadToken` dependency in both bootstraps. Added the `fileDownloadRanges` server feature (both daemons advertise every `SERVER_FEATURES` key). Fixtures: both token fixtures deleted, `file_download_request`/`_response` reshaped with `requiresFeature: "fileDownloadRanges"`, `manifest.json` `formatVersion` 2, dated `CHANGELOG.md` entry, signatures regenerated, live scenario/e2e drop the token step.

## Files created / changed
| File | Change |
|------|--------|
| `packages/server/src/files/file-transfer.ts` | download rewritten (`beginDownload`, `openDownload`, `streamDownload`, `pipeRange`); token code removed |
| `packages/server/src/files/download-token-store.ts` | deleted |
| `packages/server/src/files/file-explorer.ts`, `files/index.ts` | `transferToken` and `issueDownloadToken` removed; index export removed |
| `packages/server/src/ws/router.ts` | `RpcHandlerContext.afterReply` |
| `packages/server/src/daemon/bootstrap.ts`, `dev-bootstrap.ts` | `new FileExplorerService()` |
| `packages/protocol/src/client-capabilities.ts` (+ test) | `fileDownloadRanges` flag and COMPAT entry |
| `packages/protocol/fixtures/external-clients/*` | token fixtures deleted; download fixtures reshaped; manifest v2; CHANGELOG; README; `.signatures.json` |
| `packages/server/src/test-support/external-fixtures-scenario.ts`, `daemon/external-fixtures-e2e.test.ts` | token step removed |
| `packages/server/src/files/file-transfer.test.ts` | download tests rewritten (range, clamp, empty, every rejection, `changed`, wire order over the router, stalled-client response, read error, throwing sink, token request gone) |
| `packages/server/src/files/file-explorer.test.ts`, `daemon/bootstrap.test.ts` | updated to the new flow (relay download test drives path-based download; test client ignores binary frames) |
| `packages/server/AGENTS.md`, `packages/server/README.md`, `packages/protocol/AGENTS.md`, `docs/desktop-client-handoff.md` | stale token text replaced |

## How it satisfies the scope
Follow-ups II § 1.1, § 1.2, § 1.3, § 1.5 and § 4 (removed, changed shape). Deviation worth knowing: the `changed` Error frame (§ 1.3) is implemented here rather than in task-003, because it is part of the same read loop; `ifUnchanged`, `stream_in_use`, session-scoped ids and cancel remain for task-003.

## Build & test results
```
$ npm run build:protocol && npm run build:server
success

$ npx vitest run packages/server/src packages/protocol/src
Test Files  108 passed (108) / Tests  1634 passed (1634)   (+ fixtures e2e and protocol: 411 passed)

$ rg "DownloadTokenStore|issueDownloadToken|transferToken|invalid_or_expired_token" packages/server/src packages/protocol/src
(no matches)

$ npx oxlint <changed files>; npx oxfmt --check <changed files>
clean
```

## Acceptance criteria
- [x] Whole-file request: response and `Begin` carry `totalBytes`/`length`, `offset` 0, integer `mtimeMs` (download test).
- [x] Ranges exact; consecutive ranges rebuild the file byte for byte (range test).
- [x] Clamp, `offset` == size, zero-byte file (clamp and empty tests).
- [x] Response precedes `Begin`, nothing follows `End` (router wire-order test).
- [x] Response arrives at once while a stalled client still has most of the file to receive (stalled-client test).
- [x] Each rejection returned for its condition, no binary frame (rejection tests; `unreadable` is skipped when run as root).
- [x] Pacing test passes on a ranged download; a read error yields exactly one `Error`, no `End`.
- [x] Token request gets `rpc_error` `unknown_message_type`; the `rg` finds nothing.
- [x] `fileDownloadRanges` advertised by both daemons (`Object.values(SERVER_FEATURES)` in `bootstrap.ts`/`ws-server.ts`; live check deferred to task-007).
- [x] No token fixture; `formatVersion` 2; dated changelog entry; both fixture layers pass.
- [x] Relay download test drives the new flow and passes.

## Follow-ups / TODO(verify)
- The SDK `download` and the web client's downloads are broken against this daemon until task-004 (expected, per task).
- `swe/features/desktop-client-protocol-followups-2.md` status and `PLAN.md` are updated by the orchestrator at sprint end.
