# Architecture — External-Client Wire Fixtures & Contract Test

> **Status: shipped (sprint-083)**
>
> Deviations from the original plan are recorded inline as *Shipped:* notes and in
> [../notes/external-client-fixtures-spike.md](../notes/external-client-fixtures-spike.md).

> Part of: [../MAIN-SCOPE.md](../MAIN-SCOPE.md)
> Dependencies: [websocket-protocol.md](websocket-protocol.md) (envelopes, compat rules),
> [../features/extension-ui-rpc.md](../features/extension-ui-rpc.md) (the answerable-question family, D36),
> [../features/daemon-status-rpc.md](../features/daemon-status-rpc.md),
> [../features/daemon-log-streaming.md](../features/daemon-log-streaming.md),
> [../features/extension-ui-rpc.md](../features/extension-ui-rpc.md) (e2e harness precedent)
> Source brief: [daemon-monitoring-dashboard.md](../../../pi-studio-dashboard/swe/grills/daemon-monitoring-dashboard.md)
> (D22, D26, D34)

## Purpose

The protocol is Zod-only, and many list/orchestration/stat responses are untyped passthrough
(`packages/protocol/src/messages.ts`); there is no JSON Schema export or codegen. External clients —
first the Rust Pi Studio Dashboard, which hand-writes lenient serde types (D22) — therefore have
nothing machine-checkable to build against. This scope defines:

1. a directory of **canonical JSON fixtures**, one file per wire message type an external client
   consumes or sends, living in this repo;
2. a **contract test** in pi-studio that fails whenever the daemon's real output (or the Zod schema)
   drifts from a fixture's shape;
3. the **rule** that changing a fixture's shape is a breaking change for external clients.

The dashboard vendors a copy of the directory (recording the source commit) and deserializes every
fixture in its own tests; that half lives in the dashboard repo. The pair of tests is what keeps the
Rust types honest across pi-studio releases (D22, D34).

## Current state (verified in code)

- No fixture directory exists (`packages/protocol/fixtures` is absent).
- Protocol tests: `packages/protocol/src/session-messages.test.ts` round-trips hand-authored message
  objects through the Zod schemas; `messages.envelopes.test.ts` covers envelopes. Several consumed
  types have **no schema** or a loose one: `agent_session_stats_response` payload is `.passthrough()`;
  `list_agents_request`'s response is built inline in `daemon/bootstrap.ts` (`registry.register
  ("list_agents_request", …)`); `interrupt_agent`'s reply `{type:"interrupt_response",agentId,ok}` is
  built in `agent/session-operations.ts`; `rpc_error` is built in `ws/router.ts`.
- Server tests already run a **real in-process daemon**: `startDevDaemon({host:"127.0.0.1", port:0,
  logger: silentLogger()})` (`daemon/dev-bootstrap.ts`) — mock provider only, no auth, handle exposes
  `httpServer`, `serverId`, `manager` (reach a created agent's live `MockAgentSession`).
  `daemon/agent-ui-e2e.test.ts` and `agent-todos-e2e.test.ts` hold a reusable pattern: raw `ws`
  client, send `hello` (`clientType:"cli"`), wait for `status`, `rpc()` helper stamping `requestId`
  inside `{type:"session",message}`, `waitFor(predicate)` over the message log, scripted events via
  `MockAgentSession.emitUiRequest/emitTodos`. That helper was file-local to each test; *Shipped:* it is
  now `packages/server/src/test-support/daemon-test-client.ts` (existing tests were not migrated).
- `MockAgentSession` (`agent/providers/mock/mock-provider.ts`) can emit stream events through the
  normal turn loop (create agent, send prompt → `turn_started`, `assistant_message`, `tool_call`?,
  `turn_completed`) and UI requests (`MockAgentSession.emitUiRequest`, all methods incl. dialogs and
  retained surfaces). The tool-permission channel was retired in sprint-086 and is deliberately
  unfixtured (no `agent_permission_*` / `agent.permission.respond.*` fixtures, no dev-handle hook).
- The dev daemon reports `server_info.version` as `"0.1.0-dev"` and the mock provider only; the real
  `bootstrap.ts` is not unit-startable without a Pi binary/home, so fixtures are produced against the
  dev daemon.

## Public contract

### Location and layout

```
packages/protocol/fixtures/external-clients/
  README.md                       # the rule (§ Compatibility rule), file format, how to add one
  manifest.json                   # {"formatVersion":1,"messages":[{"file","type","direction"}...]}
  <message-type>[.<variant>].json # one file per message type (+ variants), e.g.
                                  #   hello.json, status.server_info.json, agent_stream.tool_call.json
```

- **One file per message type**; a type with materially different shapes (e.g. `agent_stream`'s
  `event.kind`, `agent_ui_request` per `method`) gets one file per variant,
  named `<type>.<variant>.json`.
- `packages/protocol` ships the directory in its npm `files` (so external consumers can pin a
  published version) — *Shipped:* `fixtures` is in `files`.
- The path is a published contract: the dashboard's vendoring script and docs reference it verbatim.

### File format

```jsonc
{
  "type": "agent_session_stats_response",       // the message `type`
  "direction": "server_to_client",              // | "client_to_server" | "http"
  "description": "Poll result for one live agent session",
  "since": "0.0.115",                           // pi-studio version that introduced this shape
  "stage": 1,                                   // 1 | 2 (dashboard staging, D5) — informational
  "requiresFeature": null,                      // e.g. "extensionUi", "daemonObservability"
  "volatile": ["/message/requestId", "/message/payload/sessionFile"],   // JSON Pointers into `frame`
  "frame": {                                    // the COMPLETE wire frame as sent on the socket
    "type": "session",
    "message": { "type": "agent_session_stats_response", "requestId": "req-1", "payload": { … } }
  }
}
```

- `frame` is the full top-level frame (including the `{type:"session",message}` envelope, or the
  bare `{type:"status",payload}` / `{type:"ping"}` forms), so the external client's decoder is tested
  from the outermost layer.
- `volatile` lists JSON Pointers whose **values** vary per run (ids, timestamps, paths, counters).
  Their presence and JSON type are still part of the contract; only the value is not compared.
- Values in `frame` for non-volatile fields are literal and compared exactly by the live-output test
  where the daemon controls them (see below).
- Fixtures contain no secrets: passwords, tokens and home paths use obviously fake literals.

### Required fixture set (the messages the dashboard consumes or sends)

Stage 1:

| Fixture file(s) | Direction | Source of truth | Schema today |
|---|---|---|---|
| `hello` | C→S | helloSchema (`hello` with `clientType:"cli"`, `appVersion:"pistudiodashboard/0.1.0"`, `capabilities`) | Zod |
| `status.server_info` | S→C | handshake (`status` envelope; `serverId, hostname, version, homeDir, capabilities, features`) | Zod |
| `ping`, `pong` | both | liveness (`requestId`, `clientSentAt?`; pong reply shape from `ws/router.ts`) | Zod |
| `list_agents_request`, `list_agents_response` | both | inline in `daemon/bootstrap.ts` | **none** |
| `agent_update`, `agent_update.model` | S→C | `agent_update` (status/title/labels + model/thinkingLevel variants emitted by the daemon beyond the schema) | partial Zod |
| `agent_status` | S→C | `agentStatusMessageSchema`. *Shipped:* no daemon code path emits it — schema-only **exception** | Zod |
| `agent_stream.user_message`, `.assistant_message`, `.reasoning`, `.tool_call`, `.tool_call.partial`, `.turn_started`, `.turn_completed`, `.turn_failed`, `.turn_canceled`, `.error`, `.compaction` | S→C | `agent_stream {agentId, seq?, timestamp, event}` — one per `event.kind` the dashboard reads (D6, D16, D27); `tool_call.partial` has no `seq` | Zod (event) / envelope inline |
| `agent_archived`, `agent_deleted` | S→C | schemas | Zod |
| `agent_timeline_reset` | S→C | broadcast from `slash-command-operations.ts` | **none** |
| `fetch_agent_timeline_request`, `fetch_agent_timeline_response` | both | `fetchAgentTimelineResponseSchema` (paging `after`/seq) | Zod |
| `agent_session_stats_request`, `agent_session_stats_response` | both | schemas (payload passthrough) | loose |
| `agent_ui_request.select`, `.confirm`, `.input`, `.editor`, `.notify` (non-dialog, `expectsResponse:false`), `.setStatus` (retained surface with `surfaceKey`), `.setStatus.removed` | S→C | `extension-ui-rpc.md`; one fixture per `method` the dashboard distinguishes: answerable `confirm`/`select`, hand-off `input`/`editor`, and non-dialog surfaces (D36, D13) | Zod |
| `agent_ui_resolved` (one per `reason`: `answered`, `cancelled`, `timeout`, `aborted`) | S→C | same. *Shipped:* the daemon emits `answered`, `timeout`, `aborted` only; `cancelled` is a documented schema-only **exception** (manifest `exception`) | Zod |
| `agent_ui_respond_request` (`confirm` → `{confirmed}`, `select` → `{value}`), `agent_ui_respond_response` (`ok:true`, `ok:false error:not_found`) | both | same — the dashboard's answer mutation (D36) | Zod |
| `agent_ui_list_request`, `agent_ui_list_response` (pending + surfaces) | both | same — late-join catch-up (D36) | Zod |
| `interrupt_agent`, `interrupt_response` | both | `session-operations.ts` (`{type:"interrupt_response",agentId,ok}`) | **none** |
| `rpc_error` | S→C | `ws/router.ts` (`requestId, code, message`; codes `unknown_message_type`, `handler_error`) | Zod |
| `health` (HTTP, `GET /api/health`) | HTTP | `http/http-server.ts` `HEALTH_PATH` — body + status as returned unauthenticated. *Shipped:* `direction: "http"`, frame `{status, contentType, body}` | **none** |

Stage 2 (added when the corresponding spec ships; flagged `"stage": 2` and `requiresFeature`):

| Fixture file(s) | Source |
|---|---|
| `daemon_status_request`, `daemon_status_response` | [daemon-status-rpc.md](../features/daemon-status-rpc.md) |
| `daemon_status_subscribe_request`, `daemon_status_unsubscribe_request`, `daemon_status_update` | same |
| `daemon_logs_subscribe_request`, `daemon_logs_unsubscribe_request`, `daemon_log_lines` | [daemon-log-streaming.md](../features/daemon-log-streaming.md) |

`manifest.json` lists every file; the contract test fails if a file is missing from the manifest or
vice versa, so adding a fixture is a deliberate, reviewed act. *Shipped:* a `client_to_server` entry
carries `response` (the fixture the daemon must answer with); an entry may carry `exception` for a
schema-only fixture no daemon path emits (`agent_status`, `agent_ui_resolved.cancelled`).

### Compatibility rule (the "bump + note" rule)

Fixtures are the published contract for clients outside this repo. Therefore:

- **Additive change** (new optional field, new variant file, new message): add/extend the fixture;
  no further action. The test verifies the daemon's output is a **superset-compatible** shape (below).
- **Breaking change** (field removed, renamed, type narrowed/changed, optional→required, a variant
  file removed or its `requiresFeature` changed): permitted only with *all* of: (1) the fixture edited
  in the same commit, (2) `formatVersion` bump in `manifest.json` **and** a dated entry in
  `fixtures/external-clients/CHANGELOG.md` naming the file(s) and the migration, (3) a `COMPAT(...)`
  note per MAIN-SCOPE § 9 if an old daemon still emits the old shape. MAIN-SCOPE § 9 already forbids
  breaking wire changes; this makes the consequence mechanical for external readers.
- The contract test enforces (1) by failing on drift and (2) by a guard that fails when any fixture
  file's *shape signature* (see below) changed relative to `fixtures/external-clients/.signatures.json`
  without `formatVersion` having changed (signatures regenerate with
  `npm run fixtures:update -w @av-pi-studio/protocol`).

## Behavior & algorithms

### Producing fixtures

Decision: **hybrid — hand-authored canonical files, kept honest by a live-daemon test**, not
recording-by-test-output.

- *Why not pure hand-authoring validated only by Zod:* many consumed messages have no schema
  (§ table "none"); Zod validation would pass vacuously and drift.
- *Why not auto-recording as the source:* recorded output bakes in incidental values and makes every
  harmless change a diff; the fixture is a reviewed contract.
- *Hybrid:* a maintainer authors/updates the fixture (a generator script,
  `packages/server/scripts/record-external-fixtures.ts`, can print a candidate from the dev daemon
  to start from — not required in CI). The test then proves daemon output matches.

### The contract test

Two layers, both vitest (per-file, matching the repo's test policy):

**Layer A — protocol package (`packages/protocol/src/external-fixtures.test.ts`, no daemon):**

```
for each manifest entry:
    f = read fixture; assert shape of f (type, direction, frame, volatile pointers resolve)
    msg = unwrap(f.frame)                         # envelope → message
    if a Zod schema exists for msg.type (registry: type -> schema, sessionMessageSchema + status/ping/…):
        assert schema.safeParse(msg).success      # client_to_server fixtures parse as requests
    assert msg.type == f.type (or the status/session envelope rules)
    assert no fixture contains a real secret pattern (password-like keys other than the literal "FAKE")
manifest <-> directory listing equality
signature guard (below)
```

**Layer B — daemon (`packages/server/src/daemon/external-fixtures-e2e.test.ts`, in-process):**

```
dev = startDevDaemon({host:"127.0.0.1", port:0, logger: silentLogger()})
client = connect(dev)                              # shared helper (see Files) — hello as clientType "cli"
drive the daemon through a scripted scenario that produces each daemon-output type:
    handshake → status.server_info
    ping → pong
    create mock agent; send prompt; script tool_call/error/compaction via MockAgentSession
        → agent_update, agent_status, agent_stream.*  (incl. a partial tool_call)
    list_agents_request; fetch_agent_timeline_request; agent_session_stats_request
    interrupt_agent → interrupt_response
    emitUiRequest → agent_ui_request; agent_ui_list_request; resolve
    unknown type with requestId → rpc_error
    mock fork to `MOCK_REBIND_ENTRY_ID` (rebinds the persistence handle) → agent_timeline_reset
    stage 2 (when flag present): status/logs scenarios
    GET /api/health over http
for each daemon-output fixture:
    live = first captured frame of that type/variant
    assert shapeMatches(fixture.frame, live, volatile)
for each client-input fixture:
    send fixture.frame (volatile ids substituted); assert daemon replied with the matching response
    fixture and NOT an rpc_error
assert every manifest entry was exercised (no fixture without a producer scenario)
```

`shapeMatches(expected, actual, volatile)`:

```
- objects: every key in `expected` must exist in `actual` with matching shape
  (actual MAY have extra keys → additive changes are allowed; reported as a warning list)
- primitives: same JSON type; value must be equal unless the pointer is in `volatile`
- arrays: element-wise on min(len); fixture arrays contain one representative element, actual
  must contain ≥ that many elements of matching shape (empty-vs-nonempty mismatch fails)
- null vs absent: distinct (a field the fixture shows as `null` must be emitted as null)
- optional fields absent in the fixture are not required in actual
```

**Shape signature** (for the breaking-change guard): the `(json-pointer → json type)` pairs for every
leaf of `frame` (volatile values never enter — only types do), stored per file in `.signatures.json`
(*Shipped:* the pairs themselves, not a hash, so the guard can diff them). Changing a field name or type changes the signature; adding an optional field
also changes it, so additive edits also regenerate signatures — the guard therefore compares
*removed or retyped* pairs only (a pair present in the old signature missing or retyped in the new one
= breaking).

### Files (new/changed)

| File | Responsibility |
|------|----------------|
| `packages/protocol/fixtures/external-clients/**` | Fixtures, `manifest.json`, `README.md`, `CHANGELOG.md`, `.signatures.json` |
| `packages/protocol/src/external-fixtures.test.ts` | Layer A + signature guard |
| `packages/server/src/daemon/external-fixtures-e2e.test.ts` | Layer B scenario + `shapeMatches` |
| `packages/server/src/test-support/daemon-test-client.ts` (new) | Extracted shared `connect/rpc/waitFor` helper (was duplicated per e2e test); existing e2e tests were not migrated |
| `packages/server/src/test-support/external-fixtures-scenario.ts` (new) | *Shipped:* the single scripted scenario shared by Layer B and the recorder |
| `packages/server/src/agent/providers/mock/stream-script.ts` (new), `mock-provider.ts` | *Shipped:* `#stream reasoning\|fail\|error` and `fork(MOCK_REBIND_ENTRY_ID)` producers; `dev-bootstrap.ts` is unchanged (no permission hook — the channel is retired) |
| `packages/server/scripts/record-external-fixtures.ts` | The recorder (`--write <dir> [--force]`), imports the built `dist` |
| `packages/protocol/scripts/*.ts` | *Shipped:* shared fixture helpers + `fixtures:update` (not compiled or published) |
| `packages/protocol/package.json` | Include `fixtures/` in `files` |
| `packages/protocol/AGENTS.md`, root `AGENTS.md` | One paragraph: the fixture directory is an external contract; edit rule |

## Data & persistence touchpoints

- Fixtures are static repo files; no runtime persistence. The dashboard vendors a copy at
  `crates/protocol/tests/fixtures/pi-studio/` recording the source pi-studio commit (dashboard side).
- The recorder script (optional) writes only into the fixtures directory and never overwrites a file
  without `--write`.

## Error handling & edge cases

| Condition | Behavior |
|-----------|----------|
| Message type has no Zod schema | Layer A skips schema validation for it; Layer B is the sole guard — a type with no schema AND no Layer B scenario is not allowed in the manifest |
| Daemon adds a new optional field | Layer B passes (extra keys allowed), reports it; maintainer updates the fixture in the same PR or a follow-up |
| Daemon removes/renames/retypes a field | Layer B fails; signature guard fails unless `formatVersion` bumped + CHANGELOG entry |
| Feature-flagged message (stage 2) not yet implemented | Fixture absent from the manifest until its spec ships; the manifest never references an unimplemented daemon behavior |
| Message no daemon path emits (`agent_status`, `agent_ui_resolved.cancelled`) | Manifest `exception`; Layer B asserts it stays unproduced and fails the day a producer appears |
| Nondeterministic output order | Layer B matches by type/variant predicate (`waitFor`), never by index |
| Platform-specific values (homeDir, paths) | Declared `volatile` |
| Flaky timing in scenario | Use the repo's existing `waitFor` polling with the same 4 s RPC timeout; no sleeps |
| Fixture contains `Date`-like strings | Declared `volatile`; type compared (string vs number) because timestamps are `epoch ms | ISO` per `wireTimestampSchema` — fixture records which form the daemon emits |

## Non-functional

- Runtime: Layer A < 1 s; Layer B one daemon start + one scenario (target < 10 s), run per-file in
  CI per repo policy ("never run the whole suite locally").
- Maintenance cost is bounded: ~45 small files; additive changes need no fixture edits to pass.
- Licence: fixtures are pi-studio data under the repo's licence; the dashboard's vendored copy is a
  test input only (dashboard D20's licensing note covers ported design values separately).

## Dependencies on other specs

- [websocket-protocol.md](websocket-protocol.md) — envelope/compat rules the fixtures encode.
- [../features/extension-ui-rpc.md](../features/extension-ui-rpc.md) — the `agent_ui_*` family is the
  dashboard's answerable-question channel (D36).
- [../features/daemon-status-rpc.md](../features/daemon-status-rpc.md),
  [../features/daemon-log-streaming.md](../features/daemon-log-streaming.md) — stage 2 fixtures.
- [../features/extension-ui-rpc.md](../features/extension-ui-rpc.md) — e2e harness precedent and the
  `agent_ui_*` messages.

## Acceptance criteria

- [x] **Directory + manifest.** `packages/protocol/fixtures/external-clients/` exists with
  `manifest.json` listing exactly the files on disk; the manifest check fails if a file is added or
  removed without updating it. (D22) *Evidence: manifest equality test, `external-fixtures.test.ts`.*
- [x] **One file per consumed type.** Every row of the stage 1 table has at least one fixture;
  `agent_stream` has one fixture per listed `event.kind`, plus `tool_call.partial` without `seq`.
  (D22) *Evidence: 48 fixtures; all 11 `agent_stream` kinds incl. `tool_call.partial` without `seq`.*
- [x] **Schema validation.** Layer A passes: every fixture whose type has a Zod schema parses with
  it; client-to-server fixtures parse as requests. (D22) *Evidence: Layer A schema parse (`sessionMessageSchema.optionsMap` + top-level schemas).*
- [x] **Live-output match.** Layer B passes: for each server-to-client fixture, a frame of the same
  type/variant captured from `startDevDaemon` matches the fixture shape (volatile values excluded).
  (D22) *Evidence: Layer B `daemon output matches the fixtures` (3.7 s).*
- [x] **Untyped messages guarded.** `list_agents_response`, `interrupt_response`,
  `agent_timeline_reset` and the `GET /api/health` response each have a fixture and fail Layer B when
  the daemon's handler output drops or retypes a field. (D22) *Evidence: mutation proofs in task-006 summary (`interrupt_response` field drop, `list_agents_response` retype, health body).*
- [x] **Client-input fixtures accepted.** Sending each client-to-server fixture to the dev daemon
  yields the paired response fixture's shape, never `rpc_error`. (D22) *Evidence: Layer B input tests (paired response shape, never `rpc_error`).*
- [x] **Breaking-change guard.** Removing or retyping a leaf in any fixture without bumping
  `formatVersion` and adding a CHANGELOG entry makes the signature guard fail; adding an optional
  field passes. (D22, D34) *Evidence: mutation proofs in task-005 summary + in-memory rule tests.*
- [x] **Coverage guard.** A manifest entry with no Layer B scenario producing it fails the test.
  (D22) *Evidence: task-006 proof: removing a scenario step names `list_agents_response.json`.*
- [x] **No secrets.** The scan finds no password/token-like values in any fixture. (D22, D32) *Evidence: Layer A `findSecrets` scan.*
- [ ] **Stage 2 additions.** When the stage 2 specs ship, their fixtures are added with
  `"stage": 2` and `requiresFeature`, and the same layers cover them. (D5, D26) *Evidence: not applicable yet: `daemon_status_*` / `daemon_log*` fixtures arrive with their sprints (084/085) — the layers already cover any manifest entry.*
- [ ] **Dashboard round trip (cross-repo, informational — not run here).** The dashboard's vendored copy deserializes
  every fixture with its lenient types; this is the dashboard repo's acceptance, not run here. (D22)

## Out of scope

- JSON Schema export / generated Rust types (brief "Deferred": D22).
- Fixtures for messages the dashboard does not use (terminals, projects, git, schedules, loops, chat).
- Binary frames.
- Relay-encrypted framing (fixtures are plaintext application frames; D3).

## Resolved TODO(verify)

All five were answered by the sprint-083 spike
([../notes/external-client-fixtures-spike.md](../notes/external-client-fixtures-spike.md)):

- [x] **`fixtures/` in npm `files`: yes.** Shipped; external clients can pin by version or commit.
- [x] **Scriptable stream events:** `reasoning`, `turn_failed`, `error` had no mock producer; the
  mock `#stream` recipe now emits them through the normal turn loop. The rest were already
  scriptable.
- [x] **`agent_timeline_reset` producer:** the mock fork rebinds its persistence handle for the
  entry id `MOCK_REBIND_ENTRY_ID`, so `handleFork`'s real broadcast runs; no production change.
- [x] **Field sets:** `list_agents_response` is identical in dev and production; the dev
  `agent_session_stats_response` payload is a subset of Pi's (`sessionId`, `totalMessages`,
  `tokens.total`, `model`) and the fixture pins that subset.
- [x] **`pong` and health:** `pong` is a top-level (not session-wrapped) frame; health is
  `200 application/json {"status":"ok"}`.
