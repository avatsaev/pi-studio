# Task 004 — Stream, extension-UI and timeline-reset fixtures — Summary

- **Sprint:** sprint-083-external-client-fixtures
- **Completed:** 2026-11-13
- **Status:** done

## What was implemented
29 further fixtures and their manifest entries (manifest now 48): `agent_stream.{user_message,assistant_message,reasoning,tool_call,tool_call.partial,turn_started,turn_completed,turn_failed,turn_canceled,error,compaction}`; `agent_ui_request.{select,confirm,input,editor,notify,setStatus,setStatus.removed}`; `agent_ui_resolved.{answered,timeout,aborted,cancelled}`; `agent_ui_respond_request.{confirm,select}`; `agent_ui_respond_response.{ok,not_found}`; `agent_ui_list_request/response`; `agent_timeline_reset`. `tool_call.partial` has no `seq`. Timestamps use the daemon's form (ISO for `agent_stream`, epoch ms for `agent_ui_*`). Permission fixtures are not present (family retired in sprint-086; README notes it).
`agent_ui_resolved.cancelled` is a manifest `exception`: no daemon path emits that reason (only `answered`, `timeout`, `aborted`), recorded in the README exception list.

## Files created / changed
| File | Change |
|------|--------|
| `packages/protocol/fixtures/external-clients/agent_stream.*.json` (11) | created |
| `.../agent_ui_*.json` (17) and `agent_timeline_reset.json` | created |
| `.../manifest.json` | 48 entries |

## Build & test results
```
$ node -e '<JSON-parse loop>'   # 49 files parsed (48 fixtures + manifest)
```

## Acceptance criteria
- [x] Every stage 1 row has a fixture; `agent_stream` has all 11 variants
- [x] Timestamp form matches the spike capture
- [x] No secrets, real paths or hosts (ids/paths canonicalized; verified by Layer A scan in task-005)

## Follow-ups / TODO(verify)
- Full checks in task-005/006.
