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
- File-transfer and terminal fixtures (since 0.0.118) cover the JSON control frames only: the
  `file_download_*`/`file_upload_*` RPCs, `file_upload_complete` (gated by `fileTransferAck`, as is
  the `ack` upload request) and the `*_terminal_*` RPCs plus the `terminals_update` broadcast.
  Most of these have no Zod schema, so Layer B is their guard. The download fixtures (`since`
  0.0.119, `fileDownloadRanges`) replaced the token flow at `formatVersion` 2 and were extended
  additively with `file_download_request.range` (offset/length/`ifUnchanged`),
  `file_download_response.rejected`, and the `file_download_cancel_request`/`_response` pair (the
  response fixtures the deterministic `{ok:false, error:"not_found"}` outcome; `ok:true` needs a
  download still running and is described, not fixtured). The binary frames are fixtured
  separately, see "Binary frames" below.
- Handshake variants: `hello.json`, `hello.platform.json` (since 0.0.118, the optional `platform`
  label) and `hello.agentStreams.json` (since 0.0.119, `requiresFeature: "agentStreamsMode"`: the
  optional `agentStreams` string, `"none"` shown, which opts the connection out of every
  `agent_stream` frame; all three are answered by `status.server_info.json`).

## Binary frames

File-transfer and terminal data travel in binary frames, not JSON. Their fixtures live in the
**`binary/` subdirectory** (since 0.0.118), with their own manifest and their own `formatVersion`
(starting at 1), so `manifest.json` and the JSON `formatVersion` are untouched. They are in a
subdirectory on purpose: a consumer that checks "every top-level `*.json` is listed in
`manifest.json`" (the Rust dashboard's vendored-fixture test does) would fail on top-level binary
files. A plain `rsync -a --delete` of this directory carries `binary/` along harmlessly.

| File | Purpose |
|---|---|
| `binary/manifest.json` | `{"formatVersion": 1, "frames": [{"file","family","opcode","direction"}]}` — lists the ten frame fixtures; the test fails on an unlisted or missing file |
| `binary/<family>.<opcode>[.<variant>].json` | One fixture per frame shape: `file_transfer.{begin,begin.download,chunk,end,error}`, `terminal.{output,input,resize,snapshot,restore}`; `begin.download` (0.0.119) is a download `Begin` carrying `totalBytes`, `mtimeMs`, `offset` and `length`, so the `Begin` opcode has two fixtures |

```jsonc
{
  "family": "file_transfer",   // | "terminal"
  "opcode": "Chunk",
  "direction": "both",         // | "server_to_client" | "client_to_server"
  "description": "…",
  "since": "0.0.118",
  "hex": "11 03 68 65 6c 6c 6f",             // the COMPLETE frame: opcode, stream/slot, payload
  "decoded": { "opcode": "Chunk", "stream": 3, "dataHex": "68 65 6c 6c 6f" }
}
```

- Frame layout is `[opcode][stream or slot][payload]`. File-transfer opcodes: `Begin` 0x10,
  `Chunk` 0x11, `End` 0x12, `Error` 0x13. Terminal opcodes: `Output` 0x01, `Input` 0x02,
  `Resize` 0x03, `Snapshot` 0x04, `Restore` 0x05. File-transfer frames are valid in **both**
  directions (a download is daemon → client, an upload client → daemon).
- `decoded` is the typed frame. Raw payloads (`Chunk`, `Output`, `Input`, `Snapshot`, `Restore`)
  appear as `dataHex`; `Begin` carries its metadata object, `End` an `ok` boolean, `Error` a
  `message`, `Resize` `rows` and `cols`.
- **How to use them.** Decode every `hex` with your own codec and compare with `decoded`; encode
  `decoded` with your own codec and compare with `hex`. For `Begin` and `Resize`, whose payload is
  JSON, compare the *parsed* payload rather than the bytes: key order and whitespace are not part of
  the contract (the fixtures show what the TypeScript codec writes). `Snapshot` and `Restore`
  payloads are opaque to the codec; the bytes shown are stand-ins.
- Layer A for binary frames is `src/external-binary-fixtures.test.ts`: it decodes each `hex` with the
  real codec, encodes `decoded` back to the same bytes, checks the first byte against a table of the
  wire opcode values, and fails on an unlisted or missing file. There is no live-daemon layer.
- **Breaking-change rule.** A change to an existing frame's `hex` (a different opcode byte, header
  or payload encoding) or to the `decoded` shape is breaking: bump `formatVersion` in
  `binary/manifest.json` and add a dated `CHANGELOG.md` entry naming the file. A new frame fixture
  is additive. This rule is enforced by review and by the round-trip test (a codec edit that moves
  the bytes fails it); there is no signature guard for binary fixtures.

## Relay fixtures

The relay protocol 2 contract (control frames, close codes, encrypted channel) is fixtured in the
**`relay/` subdirectory** (since 0.0.121), with its own `manifest.json` and its own `formatVersion`
(starting at 1), for the same reason as `binary/`: top-level `manifest.json` and its `formatVersion`
are untouched. A Rust (or other) relay client tests against these bytes without a live relay.

**Every key in `relay/keys.json` is test material (`"testMaterial": true`) and is public. Never use
it for a real daemon.**

| File | Purpose |
|---|---|
| `relay/manifest.json` | `{"formatVersion": 1, "files": [{"file","group"}]}`; `group` is `keys`, `control`, `close_codes` or `channel`; the test fails on an unlisted or missing file |
| `relay/keys.json` | Daemon and client key pairs (hex), the 15-byte `salt`, the derived `sessionId` (`deriveRelaySessionId`), the `box.before` `sharedKey`, and the example `connectionId` used by the control fixtures |
| `relay/control.<type>.json` | One per relay control frame: `relay_daemon_register`, `relay_registered`, `relay_client_connect`, `relay_dial`, `relay_daemon_attach`, `relay_paired`. `text` is the exact JSON text of the WebSocket frame |
| `relay/control.relay_register.legacy.json` | The protocol 1 `relay_register` frame (`"parked": true`): a protocol 2 relay keeps such a socket open and idle |
| `relay/close-codes.json` | `codes`: `code`, `name` (the close reason string, null for 1001 and 1009), `sender`, `condition` |
| `relay/channel.hello.json`, `relay/channel.ready.json` | The two handshake frames as `hex` plus a `decoded` form (version, client public key; salt, ready record, counter 0, nonce) |
| `relay/channel.<direction>.<kind>.json` | A text and a binary message each way: client to daemon at counters 0 and 1, daemon to client at counters 1 and 2. `hex` is the whole binary frame; `decoded` has `kind`, `kindByte`, `counter`, `nonce` and `payload` (text) or `payloadHex` (binary) |

- **How to use them.** Compare your control-frame text and close codes with the files. Rebuild each
  channel frame from the keys and salt with your own implementation (box of `kind byte ‖ payload`,
  nonce = salt ‖ direction byte ‖ 8-byte big-endian counter) and compare the bytes; open each `hex`
  and compare with `decoded`. The nonce and counter are never on the wire.
- Layer A is `packages/relay/src/relay-fixtures.test.ts`: it rebuilds every file from the keys
  through the real `channel.ts` (injected key pair and salt) and `encodeControlFrame`, checks
  `RELAY_CLOSE`, and fails on an unlisted or missing file or any changed byte.
  `relay-server.test.ts` proves the frames the real server sends equal the control-frame text.
  To regenerate after an intended change: `UPDATE_RELAY_FIXTURES=1 npx vitest run
  packages/relay/src/relay-fixtures.test.ts`.
- **Breaking-change rule.** As for `binary/`: a change to an existing file's bytes, text or
  `decoded` shape bumps `formatVersion` in `relay/manifest.json` with a dated `CHANGELOG.md` entry.

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
