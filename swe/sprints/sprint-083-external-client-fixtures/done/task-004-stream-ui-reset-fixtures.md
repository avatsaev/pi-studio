# Task 004 — Stream, extension-UI and timeline-reset fixtures

- **Sprint:** sprint-083-external-client-fixtures
- **Status:** done
- **Type:** feature
- **Area:** packages/protocol (fixtures)
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** task-002, task-003

## Goal

The remaining stage 1 rows have fixtures: one per variant the dashboard distinguishes.

## Scope references

- swe/architecture/external-client-fixtures.md § Required fixture set (stage 1): `agent_stream.*`,
  `agent_ui_*`, `agent_timeline_reset`. The `agent_permission_*` / `agent.permission.respond.*`
  rows are **dropped** (family retired in sprint-086; the spec is amended by task-007)
- swe/features/extension-ui-rpc.md (method/surface/resolution shapes)
- swe/notes/external-client-fixtures-spike.md

## What to build

Fixture files, plus their manifest entries:
- `agent_stream` variants: `user_message`, `assistant_message`, `reasoning`, `tool_call`,
  `tool_call.partial` (no `seq`), `turn_started`, `turn_completed`, `turn_failed`,
  `turn_canceled`, `error`, `compaction`.
- No permission fixtures. Layer A must not list them, and the README notes the retired family.
- `agent_ui_request` variants: `select`, `confirm`, `input`, `editor`, `notify`, `setStatus`,
  `setStatus.removed`.
- `agent_ui_resolved` variants: `answered`, `cancelled`, `timeout`, `aborted`.
- `agent_ui_respond_request` variants: `confirm`, `select`. `agent_ui_respond_response` variants:
  `ok`, `not_found`.
- `agent_ui_list_request`, `agent_ui_list_response`.
- `agent_timeline_reset`.
- Naming: `<type>.<variant>.json`. A variant the spike marked "Layer-A-only exception" carries a
  `"exception"` note in its manifest entry and in the README's exception list.

## Acceptance criteria

- [ ] Every stage 1 table row now has at least one fixture. `agent_stream` has all 11 variants
  listed.
- [ ] Fixtures use the daemon-emitted timestamp form (epoch ms vs ISO), as captured by the spike.
- [ ] No fixture holds a value that looks like a real secret, path or host.

## Test / verification plan

- Same JSON-parse loop; full checks in task-005/006.
