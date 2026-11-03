# Task 006 — CLI: suppress partial events in `agent attach` — Summary

- **Sprint:** sprints/sprint-058-tool-output-streaming
- **Completed:** 2026-11-03
- **Status:** done

## What was implemented
One guard in `attachAgent`'s `onSessionMessage` subscription, after the existing early return and
**before** the `--json` branch: `if (m.event.kind === "tool_call" && m.event.partial) return;`.
`formatStreamEvent` is unchanged (it also renders fetched items, which never contain partials).

## Files created / changed
| File | Change |
|------|--------|
| `packages/cli/src/agent-commands.ts` | modified — guard |
| `packages/cli/src/agent-commands.test.ts` | added test — partials interleaved with other events, plain and `--json` |

## How it satisfies the scope
Matches § Client CLI. The guard sits at the subscription site because `--json` bypasses
`formatStreamEvent`. No richer CLI rendering (out of scope). No deviation.

## Build & test results
```
$ npm run clean && npm run build        → success
$ npm run typecheck                     → success
$ npx oxlint <changed files>            → clean
$ npx oxfmt --check <changed files>     → all formatted
$ npx vitest run packages/cli/src/agent-commands.test.ts → 34 passed
$ npm test  (gpgsign override)          → 240 files / 3247 tests passed
```

## Acceptance criteria
- [x] A `partial: true` `tool_call` frame prints nothing in plain mode and nothing in `--json` mode
- [x] Non-partial `tool_call`, `assistant_message`, terminal events render as before (existing tests untouched)
- [x] Partials interleaved with other events print the same lines as without partials (exactly two lines asserted)

## Follow-ups / TODO(verify)
- CLI doc line is task-007's sweep; the live parallel `agent attach` check is part of task-007's live Pi run.
