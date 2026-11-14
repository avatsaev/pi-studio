# Task 006 — Sprint close — Summary

- **Sprint:** sprints/sprint-085-daemon-log-streaming
- **Completed:** 2026-11-13
- **Status:** done

## What was implemented
Combined cost run, observability docs, spec status/evidence, MAIN-SCOPE rows marked shipped.

**Cost run (D33):** dev daemon, 500 mock agents, one subscriber on status + logs (`info`), steady
200 lines/s, 60 s real time, whole-process `process.cpuUsage()` (client + load generator
in-process, so an upper bound): **0.83 % of one core** (611 frames, 11 980 lines pushed, RSS ~182 MB).
Baseline without a subscriber: 0.38 %. Under the < 1 % budget; no finding, nothing tuned.

## Files created / changed
| File | Change |
|------|--------|
| `AGENTS.md` | Protocol overview bullet for the observability family |
| `packages/server/AGENTS.md` | Observability: tap, logs service, advertised flag (stale "not advertised" bullet replaced) |
| `packages/protocol/AGENTS.md` | flag in `SERVER_FEATURES` row; schema rows no longer "not gated" |
| `fern/pages/configuration/daemon.mdx` | "Remote status and logs" paragraph (best-effort redaction, no new env var) |
| `swe/features/daemon-status-rpc.md`, `daemon-log-streaming.md` | Status shipped, criteria checked, evidence tables, TODO(verify) resolved, cost result |
| `swe/MAIN-SCOPE.md` | status/logs rows marked shipped |

## Build & test results
```
$ npm run build        # success
$ npm run typecheck    # success
$ npm run lint         # 0 errors (pre-existing warnings only)
$ npm run fmt:check    # fails only on the pre-existing baseline (40 files, none of mine)
$ npm test             # 257 files, 3522 passed, 0 failed
```

## Acceptance criteria
- [x] Every acceptance criterion of both specs checked with evidence (spec evidence tables)
- [x] Gates green (fmt:check = known baseline only)

## Follow-ups / TODO(verify)
- None. `swe/sprints/PLAN.md` left untouched (owned elsewhere).
