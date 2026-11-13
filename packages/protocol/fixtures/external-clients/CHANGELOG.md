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
