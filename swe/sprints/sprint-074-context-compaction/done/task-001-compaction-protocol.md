# Task 001 — Protocol: `compaction` stream event, compact-response estimate, `compactionEvents` flag

- **Sprint:** sprint-074-context-compaction
- **Status:** done
- **Type:** feature
- **Area:** packages/protocol
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** none

## Goal

The wire contract every later task builds on: a new `compaction` variant in
`agentStreamEventSchema`, a typed `estimatedTokensAfter` on the compact response, and the
`compactionEvents` server feature flag.

## Context / why

Compactions are invisible today. Pi emits `compaction_start`/`compaction_end`, but no
`AgentStreamEvent` kind can carry them. One variant with a `phase` field (rather than separate
started/ended kinds) lets the client upsert a single divider row per compaction, keyed by
`compactionId`.

Adding a variant is wire-safe. The SDK receive path (`daemon-client.ts` `handleTextFrame`) never
zod-parses `agent_stream`, and the web-client reducer ignores unknown kinds
(`timeline/reducer.ts`, `default:` branch). Older clients simply render nothing.

## Scope references

- `swe/features/context-compaction.md` § Public contract › Protocol
- `packages/protocol/src/messages.ts:264-313` — `agentStreamEventSchema` (append the variant last)
- `packages/protocol/src/messages.ts:510-524` — `agentCompactResponseSchema`
- `packages/protocol/src/client-capabilities.ts:41-56` (`SERVER_FEATURES`), `:63-93`
  (`SERVER_FEATURE_COMPAT`, the `thinkingLevels`/`viewerSettings`/`forkTimelineSync` entries are the
  pattern)
- `packages/protocol/src/session-messages.test.ts:299-325` — the existing compact schema tests
- `packages/protocol/AGENTS.md`

## What to build

- Append to `agentStreamEventSchema`:
  ```ts
  z.object({
    kind: z.literal("compaction"),
    compactionId: z.string(),
    phase: z.enum(["started", "completed", "failed", "canceled"]),
    reason: z.enum(["manual", "threshold", "overflow"]).optional(),
    tokensBefore: z.number().optional(),
    estimatedTokensAfter: z.number().optional(),
    summary: z.string().optional(),
    error: z.string().optional(),
    willRetry: z.boolean().optional(),
  })
  ```
  Add a doc comment stating which fields appear in which phase, and that `reason` and
  `estimatedTokensAfter` are absent on rows rebuilt from Pi's session file.
- `agentCompactResponseSchema.payload`: add `estimatedTokensAfter: z.number().optional()`.
- `SERVER_FEATURES.compactionEvents = "compactionEvents"` plus its `COMPAT` entry, following the
  `forkTimelineSync` lines exactly.
- `packages/protocol/AGENTS.md`: document the new event kind and flag where the other stream kinds
  and flags are listed.

## Out of scope

- Any producer or consumer (tasks 002–008).
- The root `AGENTS.md` protocol paragraph (task-009).

## Acceptance criteria

- [x] A `compaction` event with each of the four phases parses. An unknown phase and a missing
      `compactionId` are rejected.
- [x] `agent_compact_response` with `estimatedTokensAfter` parses, and `AgentCompactResponse`'s type
      exposes it.
- [x] `SERVER_FEATURES.compactionEvents` exists with a COMPAT tag, and the existing
      `client-capabilities` tests still pass.

## Test / verification plan

- Tests: extend `packages/protocol/src/session-messages.test.ts` (phase acceptance and rejection
  boundaries, response field).
- Run: `npx vitest run packages/protocol` and `npm run build:protocol`.

## Notes

- Do not touch `turnFailed`/`error` semantics. A failed compaction is deliberately not
  `kind:"error"`, so `runTurn`'s final-status derivation cannot flip an agent to `error` because of
  it.
