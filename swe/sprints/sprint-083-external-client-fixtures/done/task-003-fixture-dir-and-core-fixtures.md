# Task 003 — Fixture directory, manifest, README/CHANGELOG, and the core fixtures

- **Sprint:** sprint-083-external-client-fixtures
- **Status:** done
- **Type:** feature
- **Area:** packages/protocol (fixtures)
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** task-001

## Goal

The published fixture directory exists with its rules, and it holds the handshake, liveness,
agent-list, timeline, stats, interrupt, error and health fixtures.

## Scope references

- swe/architecture/external-client-fixtures.md § Location and layout, § File format, § Required
  fixture set (stage 1), § Compatibility rule
- swe/notes/external-client-fixtures-spike.md (captured shapes, volatile pointers)

## What to build

- `packages/protocol/fixtures/external-clients/`:
  - `README.md`: the compatibility ("bump + note") rule, the file format, volatile pointers, how
    to add a fixture, the recorder, the `+`/`%2B` and no-secrets conventions.
  - `CHANGELOG.md`: a first entry, "formatVersion 1".
  - `manifest.json`: `{formatVersion: 1, messages: [{file, type, direction}]}`.
- Fixtures, each `{type, direction, description, since, stage: 1, requiresFeature, volatile,
  frame}` with the full top-level frame:
  - `hello` (`clientType:"cli"`, `appVersion:"pistudiodashboard/0.1.0"`), `status.server_info`,
    `ping`, `pong`;
  - `list_agents_request`, `list_agents_response`, `agent_update`, `agent_update.model`,
    `agent_status`, `agent_archived`, `agent_deleted`;
  - `fetch_agent_timeline_request`, `fetch_agent_timeline_response`,
    `agent_session_stats_request`, `agent_session_stats_response`;
  - `interrupt_agent`, `interrupt_response`, `rpc_error`, `health` (HTTP status + body).
- `since` = the current aligned package version. Home paths, ids and timestamps are volatile.
  Passwords and tokens are obviously fake literals.

## Out of scope

- Stream, UI, permission and reset fixtures (task-004); the tests (task-005/006).

## Acceptance criteria

- [ ] Every file listed above exists, is valid JSON in the documented format, and is listed in the
  manifest. The manifest lists nothing else.
- [ ] Each fixture's non-volatile values match the spike capture (or the documented
  canonicalisation in the note).
- [ ] README states the breaking-change rule verbatim enough that an external maintainer can apply
  it without reading the spec.

## Test / verification plan

- `node -e` JSON-parse loop over the directory (the real check arrives with task-005).
- `npm run build:protocol`
