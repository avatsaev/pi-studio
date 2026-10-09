# Task 003 — Daemon: record manual compactions, guard `agent_compact_request`, advertise the flag — Summary

- **Sprint:** sprints/sprint-074-context-compaction
- **Completed:** 2026-10-09
- **Status:** done

## What was implemented
- `agent-service.ts`: exported `appendStreamEvent` (single append + `agent_stream` broadcast path; `runTurn`'s generic branch now uses it) and `ensureTimelineSeeded` (extracted from `timeline-rpc.ts`, which now calls it).
- `slash-command-operations.ts` `handleCompact`: `busy` on a running agent or an in-flight compaction (module-local set, released in `finally` on every path), resume of process-less records via `spawnOrResumeSession`, seeding before the first append, a subscription window forwarding only `compaction` events, synthetic `failed` terminal, `agent_update {compacted:true}` kept.
- `compactionEvents` flag: no wiring needed — `ws-server.ts` `defaultFeatures()` and `bootstrap.ts` both advertise every `SERVER_FEATURES` key (confirmed live).

## Files created / changed
| File | Change |
|------|--------|
| `packages/server/src/agent/agent-service.ts` | modified |
| `packages/server/src/agent/timeline-rpc.ts` | modified |
| `packages/server/src/agent/slash-command-operations.ts` | modified |
| `packages/server/src/agent/compact-handler.test.ts` | added (9 tests) |
| `packages/server/AGENTS.md` | documented |

## Build & test results
```
$ npx vitest run packages/server  -> 70 files, 892 passed
$ npm run build (all packages)    -> success
$ npx oxlint packages/server/src/agent -> clean; oxfmt applied
```
Live smoke (`dev-main.js` on :6790, SDK script): `server_info.features.compactionEvents === true`; `agent.compact()` produced `compaction started` (seq 4) then `completed` (seq 5) 1.5 s apart on the agent stream; a second concurrent `compact()` rejected with `busy: agent … is already compacting` while the first completed.

## Acceptance criteria
- [x] started+completed appended and broadcast to the active sessions with daemon seq/timestamp
- [x] running agent → `busy`, `compact` never called
- [x] in-flight → `busy`, first completes; slot released after success/failure/unsupported/resume failure
- [x] process-less record resumed; history seeded before compaction rows
- [x] synthetic `failed` with same id; no duplicate when provider emitted its own
- [x] in-turn regression: failed compaction recorded, agent ends `idle`
- [x] `timeline-rpc` tests green after the extraction

## Follow-ups / TODO(verify)
- Real-Pi verification that `compaction_end` precedes the `compact` rejection on every failure path is task-009.
- CLI-visible: `agent compact` on a running agent now errors (documented in server AGENTS.md; sprint-close docs in task-009).
