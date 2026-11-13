# External-client wire fixtures

Canonical JSON frames for every Pi Studio wire message that a client **outside this repository**
consumes or sends (first consumer: the Rust Pi Studio Dashboard). They are the machine-checkable
contract the Zod-only protocol cannot give: many list/stat/orchestration responses have no schema.

- **Location (published):** `packages/protocol/fixtures/external-clients/` — shipped in the
  `@av-pi-studio/protocol` npm package under `fixtures/external-clients/`. The path is part of the
  contract; external vendoring scripts reference it verbatim.
- **Consumer workflow:** copy this directory into your repo (record the pi-studio version or git
  commit you copied from) and deserialize every fixture with your own types in your own tests.
- **Enforcement here:** `src/external-fixtures.test.ts` (this package, no daemon) and
  `packages/server/src/daemon/external-fixtures-e2e.test.ts` (an in-process dev daemon) fail when a
  fixture is malformed, unlisted, schema-invalid, or no longer matches what the daemon really sends.

## Files

| File | Purpose |
|---|---|
| `manifest.json` | `{"formatVersion": N, "messages": [{"file","type","direction","response?","exception?"}]}` — lists every fixture; a file not in the manifest (or vice versa) fails the test |
| `<type>[.<variant>].json` | One fixture per message type; a type with materially different shapes gets one file per variant (`agent_stream.tool_call.partial.json`, `agent_ui_request.confirm.json`) |
| `CHANGELOG.md` | Dated entries for every breaking change (see below) |
| `.signatures.json` | Generated shape signatures used by the breaking-change guard — never edit by hand |

## Fixture format

```jsonc
{
  "type": "agent_session_stats_response",       // the message `type`
  "direction": "server_to_client",              // | "client_to_server" | "http" (health)
  "description": "…",
  "since": "0.0.115",                           // pi-studio version that introduced this shape
  "stage": 1,                                   // informational (dashboard staging)
  "requiresFeature": null,                      // e.g. "extensionUi": a status.features flag
  "volatile": ["/message/requestId", "/message/payload/sessionId"],  // JSON Pointers into `frame`
  "frame": { … }                                // the COMPLETE frame as sent on the socket
}
```

- `frame` is the full top-level frame: `{"type":"session","message":{…}}` for session messages, the
  bare `{"type":"status","payload":…}` / `{"type":"ping"}` / `{"type":"pong"}` forms for the rest.
  For `health` (HTTP) it is `{status, contentType, body}`.
- `volatile` lists JSON Pointers whose **values** change per run (ids, timestamps, counters, paths,
  model names). Their presence and JSON type are still part of the contract; only the value is not
  compared. Every other value is literal and compared exactly against the live daemon.
- Arrays hold **one representative element**; the daemon may send more. `null` and an absent key
  are different: a field shown as `null` is emitted as `null`.
- `status.server_info.features` pins only a few stable flags; the daemon may send more.
- Timestamps use the form the daemon emits: epoch milliseconds for `pong`, `agent_ui_*` and
  `list_agents_response.lastActivity`; ISO-8601 strings for `agent_stream.timestamp` and
  `agent_archived.archivedAt`.
- Fixtures contain **no secrets**: no real tokens, passwords, hosts or home paths — use obviously
  fake literals. The Layer A test scans for secret-looking keys.

### Manifest `response` and `exception`

- A `client_to_server` entry carries `response`: the fixture the daemon must answer with when the
  request is sent (never `rpc_error`).
- `exception` marks a fixture that **no daemon code path emits today** (schema only). It is
  validated against its Zod schema but has no live-output check. A message with no Zod schema can
  never be an exception. Current exceptions: `agent_status`, `agent_ui_resolved.cancelled`.
- The tool-permission family (`agent_permission_*`, `agent.permission.respond.*`) was retired in
  sprint-086 and deliberately has no fixtures.

## Compatibility rule ("bump + note")

These files are the published contract for clients outside this repo. Therefore:

- **Additive change** — a new optional field, a new variant file, a new message: add or extend the
  fixture. Nothing else is required; the live test accepts extra daemon fields.
- **Breaking change** — a field removed, renamed or retyped (including narrowing, or optional →
  required), a variant file removed, or a `requiresFeature` changed. Allowed only with **all** of:
  1. the fixture edited in the same commit as the daemon/schema change;
  2. `formatVersion` in `manifest.json` incremented **and** a dated entry in `CHANGELOG.md` naming
     the changed file(s) and the migration for consumers;
  3. a `COMPAT(...)` note if an older daemon still emits the old shape (MAIN-SCOPE § 9 already
     forbids breaking wire changes — this makes the consequence mechanical for external readers).

The signature guard enforces (2): it fails when a leaf path that existed in `.signatures.json` is
missing or has a different JSON type in the current fixtures, unless `formatVersion` is higher than
the recorded one and `CHANGELOG.md` mentions the file. Added leaves always pass.

## Adding or changing a fixture

1. Print a candidate from a real dev daemon (not run in CI):
   `npm run build:server && node packages/server/scripts/record-external-fixtures.ts`
   (`--write <dir>` writes `{ "frame": … }` candidates, never overwriting without `--force`).
2. Author/edit `<type>[.<variant>].json` with the metadata above; canonicalize ids to fake values and
   list every per-run value in `volatile`.
3. Add it to `manifest.json` (with `response` for requests).
4. Run `npx vitest run packages/protocol/src/external-fixtures.test.ts` and
   `npx vitest run packages/server/src/daemon/external-fixtures-e2e.test.ts`.
5. Regenerate signatures: `npm run fixtures:update -w @av-pi-studio/protocol`.
6. Breaking change? Bump `formatVersion` first and add the `CHANGELOG.md` entry (rule above).
