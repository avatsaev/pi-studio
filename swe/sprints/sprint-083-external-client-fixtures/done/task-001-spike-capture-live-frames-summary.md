# Task 001 — Spike: capture every stage 1 frame from the dev daemon — Summary

- **Sprint:** sprint-083-external-client-fixtures
- **Completed:** 2026-11-13
- **Status:** done

## What was implemented
`packages/server/scripts/record-external-fixtures.ts`: boots `startDevDaemon` in process (port 0),
drives the stage 1 scenario over a raw `ws` client and prints one frame per type/variant;
`--write <dir> [--force]` writes candidate fixtures, never overwriting without `--force`. Imports
from `../dist` so it needs `npm run build:server` first. `swe/notes/external-client-fixtures-spike.md`
records producer, volatile pointers and a decision per row, plus answers to the five TODO(verify)s.

## Files created / changed
| File | Change |
|------|--------|
| `packages/server/scripts/record-external-fixtures.ts` | created |
| `swe/notes/external-client-fixtures-spike.md` | created |

## Key findings
- Missing producers: `reasoning`, `turn_failed`, `error` (→ `#stream` recipe), `agent_timeline_reset` (→ mock fork rebind), `agent_status` (no daemon producer anywhere → Layer-A-only exception).
- Dev and production `list_agents_response` have identical field sets.
- `pong` is top-level; health body is `{"status":"ok"}`; dev `server_info.version` is `0.1.0-dev`.
- `agent_update.model` only emits on session-less draft agents under the mock.
- Recommendation: ship `fixtures/` in the protocol npm `files`.

## Build & test results
```
$ npm run build:server            # success
$ node packages/server/scripts/record-external-fixtures.ts   # printed frames, exit 0
$ npx oxfmt + npx oxlint on the script   # clean
```

## Acceptance criteria
- [x] Every stage 1 row has a producer decision (note table)
- [x] Recorder runs and exits 0
- [x] All five TODO(verify) answered with evidence

## Follow-ups / TODO(verify)
- Script is refactored onto the shared test client in task-002.
