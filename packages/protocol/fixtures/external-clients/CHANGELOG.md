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
