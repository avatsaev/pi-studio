# Task 002 — Daemon: download by path, ranged and sized, answered before the stream; token removed

- **Sprint:** sprint-097-download-ranges
- **Status:** done
- **Type:** feature
- **Area:** packages/server (files, daemon), packages/protocol (feature flag, fixtures)
- **Priority:** P1
- **Estimated size:** M
- **Depends on:** task-001

## Goal
`file_download_request` takes a path and an optional byte range, answers before it streams, and announces the file's size. The download token no longer exists.

## Context / why
Today a download needs two requests (`file_download_token_request`, then `file_download_request { token }`), always starts at byte 0, never says how large the file is, and sends its response only after the last frame, so a transfer that outlasts the client's request timeout is reported as failed. The token authorises nothing: both requests travel on the same authenticated socket.

This task is the one breaking cut of the scope (decisions D1, D4, D7). It is larger than the others because the live fixture test pins the daemon to the fixtures, so the handler and the fixtures must change together.

## Scope references
- `swe/features/desktop-client-protocol-followups-2.md` § 1.1, § 1.2, § 1.3, § 1.5, § 1.8, § 4 (rows "Removed" and "Changed shape"), § Download (daemon)
- `packages/server/src/files/file-transfer.ts` (`registerHandlers`, `startDownload`, `issueDownloadToken`, `DownloadPacing`)
- `packages/server/src/files/download-token-store.ts` (deleted)
- `packages/server/src/files/file-explorer.ts` (`transferToken` in the binary preview result, the `issueDownloadToken` dependency)
- `packages/server/src/files/resolve-path.ts` (path expansion and resolution, as the token request uses it today)
- `packages/server/src/daemon/bootstrap.ts`, `packages/server/src/daemon/dev-bootstrap.ts` (`new FileExplorerService({ issueDownloadToken })`)
- `packages/server/src/ws/router.ts` (`dispatchSessionMessage`: when a handler's reply is sent)
- `packages/protocol/src/client-capabilities.ts` (`SERVER_FEATURES`, the `COMPAT` table)
- `packages/protocol/fixtures/external-clients/` (`manifest.json`, `CHANGELOG.md`, `.signatures.json`, the four `file_download_*` fixtures)
- `packages/server/src/test-support/external-fixtures-scenario.ts`
- Tests: `packages/server/src/files/file-transfer.test.ts`, `files/file-explorer.test.ts`, `daemon/bootstrap.test.ts` (the relay download test), `daemon/external-fixtures-e2e.test.ts`, `packages/protocol/src/external-fixtures.test.ts`

## What to build
Request `file_download_request { path, stream?, offset?, length? }`:
- `path` is required. `~` is expanded by the daemon and the result resolved through symlinks.
- `offset` defaults to 0. `length` defaults to "to the end of the file" and is clamped to it.
- `stream` handling does not change in this task (task-003 changes it).

Response `file_download_response`, sent **before** any binary frame:
- Accepted: `{ ok: true, stream, transferId, totalBytes, mtimeMs, offset, length }`. `totalBytes` is the whole file's size, `length` the number of bytes that follow, `mtimeMs` the modification time truncated to whole milliseconds.
- Rejected: `{ ok: false, error, stream? }` and no binary frame. Errors in this task: `missing_path`, `not_found`, `not_a_file`, `unreadable`, `invalid_stream`, `invalid_range`, `range_not_satisfiable` (`offset` greater than the size).

Frames after an accepted response: `Begin` (metadata now always carries `totalBytes`, `mtimeMs`, `offset`, `length`, equal to the response), `Chunk`… for exactly the announced bytes, `End`. A read error sends `Error` `read_failed` and no `End`. A closed socket sends nothing. No message follows `End` or `Error`. Pacing is unchanged.

Removed, with no compatibility path:
- the `file_download_token_request` handler, `DownloadTokenStore` and its file, `FileTransferService.issueDownloadToken`, the `invalid_or_expired_token` error;
- `transferToken` in the file explorer's binary preview result, and the `issueDownloadToken` dependency in both bootstraps (`metadata` stays).

Feature flag: `SERVER_FEATURES.fileDownloadRanges`, with its `COMPAT` entry. Both daemons advertise every flag automatically.

Fixtures (every breaking fixture change of this scope happens here, so the version is bumped once):
- delete `file_download_token_request.json` and `file_download_token_response.json`;
- `file_download_request.json` carries `path` instead of `token`; `file_download_response.json` is the acceptance reply; both get `requiresFeature: "fileDownloadRanges"`;
- `manifest.json` `formatVersion` 1 → 2; a dated `CHANGELOG.md` entry under `## formatVersion 2` naming the files and the migration (request by `path`; read the response before the frames);
- regenerate signatures: `npm run fixtures:update -w @av-pi-studio/protocol`;
- the live scenario drops the token step.

Shared documents: `docs/desktop-client-handoff.md` and `swe/features/desktop-client-protocol-followups-2.md` are touched by most tasks of this sprint. Run alone, update what this task makes stale there. In a parallel wave, do not edit them: put the exact changes in the summary and the orchestrator applies them after the wave gate.

## Out of scope
- `ifUnchanged`, the `changed` errors, `stream_in_use`, session-scoped stream ids, cancellation, releasing downloads when a session closes (task-003).
- The SDK (task-004). **After this task the SDK's `download`, and with it the web client's downloads, fail against this daemon until task-004.** No automated test covers that path; do not live-check the browser here.
- New fixture files (task-005).

## Acceptance criteria
- [ ] A request with `path` and no range sends the whole file. The response and `Begin` carry the file's size as `totalBytes` and `length`, `offset` 0, and an integer `mtimeMs`.
- [ ] A request with `offset` and `length` sends exactly those bytes; concatenating consecutive ranges reproduces the file byte for byte.
- [ ] `length` beyond the end is clamped and the real count reported; `offset` equal to the size yields `length: 0`, `Begin`, `End`; a zero-byte file yields `totalBytes: 0`, `Begin`, `End`.
- [ ] On the wire the response precedes `Begin`, and nothing follows `End`.
- [ ] A download that runs longer than the client's request timeout completes: a test receives the response at once while the stream is still being paced.
- [ ] Each rejection listed above is returned for its condition, with no binary frame.
- [ ] The sprint 096 pacing test passes on a ranged download; a read error still yields exactly one `Error` and no `End`.
- [ ] `file_download_token_request` gets `rpc_error` `unknown_message_type`. `rg "DownloadTokenStore|issueDownloadToken|transferToken|invalid_or_expired_token" packages/server/src packages/protocol/src` finds nothing.
- [ ] `server_info.features.fileDownloadRanges` is `true` on the production and the dev daemon.
- [ ] The fixture directory has no token fixture; `manifest.json` has `formatVersion` 2; the changelog has the dated breaking entry; both fixture test layers pass.
- [ ] The relay download test in `bootstrap.test.ts` drives the new flow and passes.

## Test / verification plan
- `npx vitest run packages/server/src/files packages/server/src/daemon/bootstrap.test.ts packages/server/src/daemon/external-fixtures-e2e.test.ts packages/protocol/src`
- `npm run build:protocol && npm run build:server`
- `npx oxfmt <changed files>`

## Notes
- **Reply ordering.** The router sends a handler's return value only after the handler settles (`dispatchSessionMessage`). The stream must therefore start after that send, not inside the awaited handler. Assert the order on the wire in a test, not by reasoning.
- `Math.trunc(stat.mtimeMs)`: Node reports fractional milliseconds, and a client must be able to echo the value back exactly (task-003 compares it).
- The signature guard accepts a breaking fixture change only together with a higher `formatVersion` and a changelog entry under that version; see the fixtures `README.md` § Compatibility rule.
- Version for `since` and `addedIn`: the release that carries this work (0.0.119 unless another release lands first).
- Spec TODO(verify): no client in this repository reads `transferToken`; an out-of-tree reader was not checked.
