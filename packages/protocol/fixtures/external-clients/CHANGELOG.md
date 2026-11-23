# External-client fixtures — changelog

Breaking changes to any fixture's shape require a `formatVersion` bump in `manifest.json` and a
dated entry here naming the file(s) and the migration. See `README.md` § Compatibility rule.

## formatVersion 1 — 2026-11-13

Initial release of the fixture directory (pi-studio 0.0.115): handshake, liveness, agent list and
lifecycle, `agent_stream` event variants, timeline paging/reset, session stats, interrupt,
`rpc_error`, the `agent_ui_*` extension-UI family and the `GET /api/health` response. No migration.

## Additive — 2026-11-13 (formatVersion stays 1)

Stage 2 fixtures, gated by `requiresFeature: "daemonObservability"` (pi-studio 0.0.115):
`daemon_status_request`/`_response`, `daemon_status_subscribe_request`/`_response`,
`daemon_status_unsubscribe_request`/`_response`, `daemon_status_update`,
`daemon_logs_subscribe_request`/`_response`, `daemon_logs_unsubscribe_request`/`_response` and
`daemon_log_lines`. New files only; no existing fixture changed, no migration.

## Additive — 2026-11-14 (formatVersion stays 1)

`hello.platform.json` (pi-studio 0.0.118): a `hello` variant carrying the new optional
`platform` string. New file only; no existing fixture changed, no migration. `daemon_status`
client entries may now also carry `platform` — a field present only when the client sent one, so
the existing `daemon_status_*` fixtures are unchanged.

## Additive — 2026-11-14 (formatVersion stays 1)

File-transfer and terminal fixtures (pi-studio 0.0.118): `file_download_token_request`/`_response`,
`file_download_request`/`_response`, `file_upload_request`/`_response`, `file_upload_complete`
(`requiresFeature: "fileTransferAck"`, as is the upload request, which now shows `ack: true`),
`create_terminal_request`/`_response`, `subscribe_terminal_request`/`_response`,
`list_terminals_request`/`_response`, `rename_terminal_request`/`_response`,
`capture_terminal_request`/`_response`, `kill_terminal_request`/`_response` and `terminals_update`.
New files only; no existing fixture changed, no migration. The binary frames are fixtured separately
(next entry).

## Additive — 2026-11-14, binary frames (`binary/`, its own formatVersion 1)

`binary/` (pi-studio 0.0.118): `manifest.json` (`formatVersion` 1, independent of the JSON
manifest's) plus nine frame fixtures — file transfer `Begin`/`Chunk`/`End`/`Error` and terminal
`Output`/`Input`/`Resize`/`Snapshot`/`Restore` — each a complete frame as `hex` with its `decoded`
form. New files in a new subdirectory only: `manifest.json`, its `formatVersion` and every JSON
fixture are untouched, no migration. A consumer that vendors this directory wholesale needs no
change; one that lists top-level `*.json` against `manifest.json` is unaffected because the new
files are not top-level.

## formatVersion 2 — 2026-11-15

Breaking (pi-studio 0.0.119, `requiresFeature: "fileDownloadRanges"`): a download is requested by
path, answered before it streams, and announces the file's size. Decided with the project owner
(`swe/features/desktop-client-protocol-followups-2.md` D1, D4, D7); no compatibility release.

- `file_download_token_request.json` and `file_download_token_response.json` are **removed**. The
  token authorised nothing: both requests travel on the same authenticated socket. Migration: drop
  the token round trip.
- `file_download_request.json`: the required `token` field is replaced by a required `path`. Optional
  `stream` is unchanged; `offset` and `length` (a byte range) are new and optional. Migration:
  send `{ path, stream? }`.
- `file_download_response.json`: sent **before** the binary frames instead of after the `End` frame,
  and an accepted reply now carries `totalBytes`, `mtimeMs`, `offset` and `length`. Errors are now
  `missing_path`, `not_found`, `not_a_file`, `unreadable`, `invalid_stream`, `invalid_range`,
  `range_not_satisfiable`; `invalid_or_expired_token` and `connection_closed` are gone, and a read
  failure arrives as an `Error` binary frame. Migration: read the response first, then expect
  `length` bytes of `Chunk` frames and one `End` (or `Error`).

An older daemon (no `fileDownloadRanges` flag) still speaks the formatVersion 1 shapes; check
`server_info.features.fileDownloadRanges` before choosing. The binary `Begin` metadata also gains the
optional `mtimeMs`, `offset` and `length` (additive; the binary fixtures and their `formatVersion`
are unchanged).

## Additive — 2026-11-15 (formatVersion stays 2; binary `formatVersion` stays 1)

Download shapes added by pi-studio 0.0.119 (`requiresFeature: "fileDownloadRanges"`). New files
only; no existing leaf path changed type or disappeared, no migration:

- `file_download_request.range.json`: a request carrying `offset`, `length` and `ifUnchanged`
  (`{size, mtimeMs}`), answered by `file_download_response.json`.
- `file_download_response.rejected.json`: an `ok: false` reply (`error: "not_found"` shown).
- `file_download_cancel_request.json` and `file_download_cancel_response.json`: the cancel exchange.
  The response fixtures the `ok: false`, `error: "not_found"` outcome (a cancel for a stream with no
  download running), the one a test can produce every run. The `ok: true` outcome, for a download
  still in flight, is described in the file but not fixtured.
- `binary/file_transfer.begin.download.json`: a download `Begin` whose metadata carries `totalBytes`,
  `mtimeMs`, `offset` and `length`. It is a second `Begin` fixture next to the unchanged
  `file_transfer.begin.json`; the binary directory now holds ten fixtures.

`file_download_response.json` only had its `description` refreshed (errors `stream_in_use`, `changed`,
`no_free_stream`; `changed` also carries `totalBytes` and `mtimeMs`) and `/message/offset` and
`/message/length` added to its `volatile` list, because the ranged request is answered by it too.
Its leaf paths and types are unchanged.

## Additive — 2026-11-15 (formatVersion stays 2)

`hello.agentStreams.json` (pi-studio 0.0.119, `requiresFeature: "agentStreamsMode"`): a `hello`
variant carrying the new optional `agentStreams` string (`"none"` shown; `"all"` is the default and
any other value reads as `"all"`). New file only; no existing fixture changed, no migration.
`daemon_status` client entries may now also carry `agentStreams`, present only when the mode is not
`"all"`, so the existing `daemon_status_*` fixtures are unchanged. A daemon without the feature
flag ignores the field and sends every `agent_stream` frame.

## Additive — 2026-11-15 (top-level formatVersion unchanged)

New subdirectory `relay/` (pi-studio 0.0.121) with its own `manifest.json`, `formatVersion` 1:
fixed-key fixtures for relay protocol 2 — `keys.json` (test material), the six control frames and
the legacy `relay_register` frame, `close-codes.json`, and the channel `hello`, `ready` and
text/binary messages in both directions. New files only; no top-level or `binary/` fixture changed,
no migration.

## Additive — 2026-11-23 (formatVersion stays 2)

`health.json` (daemon self-update, `swe/features/self-update.md`): the `GET /api/health` body gains
`version`, the daemon's package version (a string; listed in `volatile` as `/body/version`, its
presence and type are the contract). `status` is unchanged, so every existing reader (the Docker
HEALTHCHECK, the CLI's probe, the desktop) keeps working. No existing leaf changed type or
disappeared, no migration. A daemon built before this change answers only `{ "status": "ok" }`.
