# Task 002 — Provider layer: Pi event mapping, session hydration, mock compaction

- **Sprint:** sprint-074-context-compaction
- **Status:** done
- **Type:** feature
- **Area:** packages/server (agent/providers/pi, agent/providers/mock)
- **Priority:** P1
- **Estimated size:** M
- **Depends on:** task-001

## Goal

Providers produce `compaction` stream events. The Pi adapter maps Pi's live events and rebuilds
completed compactions from the session file, and the mock provider emits a realistic
started → completed pair so the dev daemon can exercise the flow.

## Context / why

`event-mapper.ts` currently maps `compaction_start`/`compaction_end` to `null` (G1).
`session-hydration.ts` drops `compaction` entries (G6), so a restarted daemon shows no compaction
history. The mock's `compact()` emits nothing (G7).

Pi 1.1.0 facts (verified in `dist/core/agent-session.js`, see the spec's § Ground truth):
- `compaction_start {reason}` and
  `compaction_end {reason, result?, aborted, willRetry, errorMessage?}`, where `result` is
  `{summary, firstKeptEntryId, tokensBefore, estimatedTokensAfter, usage?, details?}`.
- Every failure path inside `compact()`, including `"Nothing to compact"` and `"Already
  compacted"`, emits `compaction_end` (no result, `errorMessage`) before throwing.
- The session entry is `CompactionEntry {type:"compaction", id, timestamp, summary,
  firstKeptEntryId, tokensBefore, …}`, with no `reason` and no `estimatedTokensAfter`.

## Scope references

- `swe/features/context-compaction.md` § Public contract › Server (Pi event mapper, Session
  hydration, Mock provider rows)
- `packages/server/src/agent/providers/pi/event-mapper.ts:242-247` — the ignored-kinds block
- `packages/server/src/agent/providers/pi/session-hydration.ts:123-126` (`mapEntry`), `:136-195`
  (`hydrateTimelineFromSessionFile`)
- `packages/server/src/agent/providers/mock/mock-provider.ts:353-358` (`compact()`); its
  `startTurn`/`interrupt` show how the mock emits events
- Tests: `packages/server/src/agent/providers/pi/pi-adapter.test.ts` (mapper cases),
  `.../pi/session-hydration.test.ts`, `.../mock/mock-provider.test.ts:104-110`
- `node_modules/@earendil-works/pi-coding-agent/dist/core/agent-session.d.ts` (event union),
  `dist/core/session-manager.d.ts` (`CompactionEntry`)

## What to build

**Pi event mapper.** Remove `compaction_start`/`compaction_end` from the ignored block.
- `compaction_start` → mint `compactionId` (`randomUUID()`), remember it as the open compaction, and
  emit `{kind:"compaction", phase:"started", compactionId, reason}`.
- `compaction_end` → use the open id (mint a fresh one if none is open), clear it, and emit the
  terminal phase:
  - `aborted: true` → `canceled`.
  - `result` present → `completed`, with `tokensBefore`, `estimatedTokensAfter`, `summary`,
    `willRetry`.
  - otherwise → `failed`, with `error: errorMessage`.
- Read fields defensively (the mapper switches on a loose string; follow its existing narrowing
  style). Keep the other ignored kinds ignored.

**Session hydration.** `mapEntry`: a `compaction` entry →
`[{kind:"compaction", phase:"completed", compactionId: entry.id, tokensBefore, summary}]`. It is
pushed at its branch position by the existing loop. Do not change turn bracketing: a manual
compaction between turns lands inside the still-open previous turn, before its invisible closer,
which is harmless.

**Mock provider.** `compact()` emits `started` (reason `"manual"`), waits a short named constant
delay (long enough to see the in-progress UI in `npm run dev:daemon`, e.g. 1.5 s), emits
`completed` with non-zero `tokensBefore`/`estimatedTokensAfter` and a summary, then resolves the
same values. Interrupting a mock compaction is not required.

**Docs.** `packages/server/AGENTS.md`: note in the Pi event-mapper section that compaction events
are now mapped (and how ids correlate), and in the hydration section that compaction entries are
replayed.

## Out of scope

- Recording or broadcasting these events outside a turn (task-003).
- Any change to `auto_retry_*`, `turn_start`/`turn_end` handling.

## Acceptance criteria

- [x] start → end(result) maps to `started` then `completed` with the **same** `compactionId`,
      carrying `reason`, `tokensBefore`, `estimatedTokensAfter`, `summary` and `willRetry`.
- [x] end(aborted) → `canceled`. end(no result, errorMessage) → `failed` with `error`. An end with
      no prior start still yields exactly one terminal event.
- [x] Two sequential compactions get distinct ids.
- [x] Hydrating a session file that contains a compaction entry yields one `completed` row with
      `compactionId === entry.id` at the entry's position, and its other rows are unchanged.
- [x] The mock's `compact()` emits started then completed to subscribers and resolves a payload
      with `estimatedTokensAfter`. The existing mock test is updated to the new values.

## Test / verification plan

- Tests: mapper cases in `pi-adapter.test.ts` (feed raw Pi events, assert mapped output); a
  hydration fixture with a compaction entry in `session-hydration.test.ts` (build the JSONL the way
  the existing fixtures do); a mock subscriber test.
- Run: `npx vitest run packages/server/src/agent/providers` and `npm run build:server`.

## Notes

- The mapper is per-session and stateful already (it latches turn disposition), so holding the
  open compaction id there is consistent.
