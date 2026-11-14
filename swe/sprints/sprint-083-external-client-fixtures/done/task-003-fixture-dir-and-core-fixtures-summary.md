# Task 003 — Fixture directory, manifest, README/CHANGELOG, core fixtures — Summary

- **Sprint:** sprint-083-external-client-fixtures
- **Completed:** 2026-11-13
- **Status:** done

## What was implemented
`packages/protocol/fixtures/external-clients/` with `README.md` (format, volatile pointers, bump + note rule, exceptions, how to add), `CHANGELOG.md` (formatVersion 1), `manifest.json` (19 entries), and the core fixtures: `hello`, `status.server_info`, `ping`, `pong`, `list_agents_request/response`, `agent_update`, `agent_update.model`, `agent_status`, `agent_archived`, `agent_deleted`, `fetch_agent_timeline_request/response`, `agent_session_stats_request/response`, `interrupt_agent`, `interrupt_response`, `rpc_error`, `health`.
Fixtures were generated from the recorder's capture (canonicalized: fake ids/timestamps/home path, arrays trimmed to one representative, per-run values listed in `volatile`); client→server fixtures were authored and carry a manifest `response` pairing. `agent_status` is a manifest `exception` (no daemon producer; schema-only).

## Files created / changed
| File | Change |
|------|--------|
| `packages/protocol/fixtures/external-clients/{README.md,CHANGELOG.md,manifest.json}` | created |
| `packages/protocol/fixtures/external-clients/*.json` (19 core fixtures) | created |

## Build & test results
```
$ node -e '<JSON-parse loop over the directory>'   # all parsed
$ npm run build:protocol                            # success
```

## Acceptance criteria
- [x] Every listed file exists, valid JSON in the documented format, listed in the manifest; manifest lists nothing else
- [x] Non-volatile values match the spike capture
- [x] README states the breaking-change rule so an external maintainer can apply it

## Follow-ups / TODO(verify)
- Real checks arrive in task-005 (Layer A) and task-006 (Layer B).
