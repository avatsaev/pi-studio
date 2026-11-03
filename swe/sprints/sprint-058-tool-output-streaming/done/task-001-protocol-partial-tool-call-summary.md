# Task 001 — Protocol: optional `partial` on the `tool_call` stream event — Summary

- **Sprint:** sprints/sprint-058-tool-output-streaming
- **Completed:** 2026-11-03
- **Status:** done

## What was implemented
The `tool_call` branch of `agentStreamEventSchema` gained one optional boolean, `partial`. Its schema
comment records the producer contract (no `seq`, never appended to the timeline, never replayed from
history, never sent after the call's terminal event) and the consumer contract (upsert by `callId`,
supersede rather than accumulate, never store on the row model). `agent_stream.seq` was already
optional, so no envelope change was needed.

## Files created / changed
| File | Change |
|------|--------|
| `packages/protocol/src/messages.ts` | modified — `partial: z.boolean().optional()` + contract comment |
| `packages/protocol/src/session-messages.test.ts` | added tests — partial true/false/absent parse, non-boolean rejected, seq-less `agent_stream` envelope accepted (and with `seq`) |

## How it satisfies the scope
Matches `swe/features/tool-output-streaming.md` § Public Contract → Protocol amendment. No field was
removed, renamed or narrowed (root invariant 1); `status` stays an open string. The existing
stream-kind discrimination test passes untouched; no hardcoded kind count was added.

## Build & test results
```
$ npx vitest run packages/protocol
Test Files  11 passed (11)
Tests  182 passed (182)

$ npm run build:protocol
tsc -b packages/protocol  → success

$ npx oxlint packages/protocol/src/messages.ts packages/protocol/src/session-messages.test.ts
clean

$ npx oxfmt --check packages/protocol/src/messages.ts packages/protocol/src/session-messages.test.ts
All matched files use the correct format.
```

## Acceptance criteria
- [x] `tool_call` validates with `partial: true`, `partial: false`, and without it (unchanged parse) — new test.
- [x] `agent_stream` validates without `seq` and with `seq` — new test.
- [x] Existing stream-kind discrimination test passes untouched.
- [x] No existing field removed/renamed/narrowed; `partial` optional.
- [x] Schema comment states producer/consumer obligations.

## Follow-ups / TODO(verify)
- Docs for the new field (`packages/protocol/AGENTS.md`, root `AGENTS.md`) are task-007's sweep, as scoped.
