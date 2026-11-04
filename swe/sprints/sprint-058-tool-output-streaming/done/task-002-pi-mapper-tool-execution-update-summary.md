# Task 002 — Pi mapper: `tool_execution_update` → partial `tool_call` — Summary

- **Sprint:** sprints/sprint-058-tool-output-streaming
- **Completed:** 2026-11-03
- **Status:** done

## What was implemented
`tool_execution_update` is no longer dropped. The mapper now emits
`{ kind: "tool_call", callId, tool, status: "running", partial: true }`. `outputOf` reads
`result.content ?? partialResult.content` (one reader for both shapes; `result` wins). The mapper
stays pure/stateless: no throttling, no per-call state, successive snapshots are never concatenated.
`tool_execution_update` was removed from the deliberate-ignore list; the three doc comments that
enumerate the tool events now name it.

## Files created / changed
| File | Change |
|------|--------|
| `packages/server/src/agent/providers/pi/event-mapper.ts` | modified — new case, dual-shape `outputOf`, comment sweep, ignore list shrunk |
| `packages/server/src/agent/providers/pi/pi-adapter.test.ts` | added tests — `tool_execution_update (sprint-058)` block (8 mapper cases) + hoisted `textContent` helper |

## How it satisfies the scope
Matches `swe/features/tool-output-streaming.md` § Pi event mapping and design tenet 3. Covered edge cases from the re-baselined spec: `bash`'s initial empty update (`content: []`) and non-text-only content map to no `output` field; nested `<parent>/<n>` ids flow through; `message_update`/`toolcall_end` still yields `"started"` without `partial`. No deviation.

## Build & test results
```
$ npm run clean && npm run build        → success (all packages)
$ npm run typecheck                     → success
$ npx oxlint <changed files>            → clean
$ npx oxfmt --check <changed files>     → all formatted
$ npx vitest run packages/server/src/agent/providers/pi
Test Files 7 passed (7)   Tests 148 passed (148)
```

## Acceptance criteria
- [x] Update maps to running partial `tool_call` with joined `partialResult` text (mapper test)
- [x] `partialResult` read when `result` absent, `result` still read when present (both-direction test)
- [x] Start event: `output: undefined`, `running`, no `partial`
- [x] `message_update`/`toolcall_end` still `"started"`, no `partial`
- [x] End event unchanged (`completed`/`error`, no `partial`, edit patch from `result.details.patch`)
- [x] Command/path/query detail identical for update vs start with same `args`
- [x] Two successive updates each carry exactly Pi's text (no concatenation)
- [x] Empty and non-text content → no `output` field
- [x] Nested `toolCallId` maps to a partial with the nested `callId`

## Follow-ups / TODO(verify)
- Only `bash` is verified as snapshot-style `partialResult`; delta-style custom tools degrade to "latest chunk" (documented in the feature spec's TODO(verify) #4).
- Docs (`docs/agent-stream-events.md` ignored list) are task-007's sweep.
