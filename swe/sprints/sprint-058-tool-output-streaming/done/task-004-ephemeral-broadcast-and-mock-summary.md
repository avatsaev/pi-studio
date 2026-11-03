# Task 004 — Ephemeral broadcast branch + mock `#tool` scenario — Summary

- **Sprint:** sprints/sprint-058-tool-output-streaming
- **Completed:** 2026-11-03
- **Status:** done

## What was implemented
`appendStreamEvent` (`agent-service.ts`) gained the ephemeral branch: a partial `tool_call` and
`queue_update` are broadcast as `agent_stream { agentId, timestamp, event }` with a daemon-owned
timestamp, **no `seq`, no `timeline.append`**. The second caller (`slash-command-operations.ts`
compaction events) is unchanged. The mock provider gained a `#tool` prompt recipe
(`tool-script.ts`): `#tool` / `#tool shell` emits a start row, three partials with growing
accumulated output, a `completed` row, then the usual echo; `#tool empty` ends with an empty final
output; `#tool help` lists recipes. Mock `emit()` keeps partials out of its own `history`.

## Files created / changed
| File | Change |
|------|--------|
| `packages/server/src/agent/agent-service.ts` | modified — ephemeral branch inside `appendStreamEvent` |
| `packages/server/src/agent/providers/mock/tool-script.ts` | created — recipe parser/help/event builder |
| `packages/server/src/agent/providers/mock/tool-script.test.ts` | created — 5 tests |
| `packages/server/src/agent/providers/mock/mock-provider.ts` | modified — `startToolScriptTurn`, history exclusion |
| `packages/server/src/agent/providers/mock/mock-provider.test.ts` | added `#tool` describe |
| `packages/server/src/agent/ephemeral-stream.test.ts` | created — 3 tests (no-seq broadcast, persistence, `queue_update`) |

## How it satisfies the scope
Matches § Server persistence policy. The `queue_update` alignment (the spec's TODO(verify) #1) is
confirmed safe: no existing assertion broke (`turn-settlement`, `compact-handler`, `session-ops`
steering tests pass untouched), and a row's `queued` flag is only ever set client-side. The
original draft's "persisted record on disk has no partial rows" criterion was vacuous
(`AgentRecord.timeline` is never written from the store); the `streamHistory()` assertion replaces it.

## Build & test results
```
$ npm run clean && npm run build        → success
$ npm run typecheck                     → success
$ npx oxlint <changed files>            → clean
$ npx oxfmt --check <changed files>     → all formatted (after one oxfmt pass on 3 new files)
$ npm test   (GIT_CONFIG override disabling commit.gpgsign — see note)
Test Files 240 passed (240)   Tests 3247 passed (3247)
```
Note: without the override, 19 tests in `git-ops`/`git-status`/`worktree-service`/`bootstrap` fail
because this host has `commit.gpgsign=true` with a missing `~/.ssh/id_rsa.pub`
(`git commit` → "failed to write commit object"). That is environmental and unrelated to this sprint.

## Acceptance criteria
- [x] `#tool` turn leaves `timeline.allRows()` with start + end rows only; subscribers get all 3 partials live
- [x] Partial broadcasts carry no `seq` and do carry a daemon `timestamp`
- [x] `fetch_agent_timeline_request` has no partials; the call projects to one `tool_call` item
- [x] Mock `streamHistory()` has no `partial: true` event, keeps start + end
- [x] `queue_update` no longer appended; still broadcast live; steering tests pass
- [x] Other events unchanged (`turn-settlement`, `compact-handler` pass untouched)
- [x] `#tool help` lists recipes and emits no tool events

## Follow-ups / TODO(verify)
- Docs for the ephemeral branch and the `#tool` recipe are task-007's sweep.
