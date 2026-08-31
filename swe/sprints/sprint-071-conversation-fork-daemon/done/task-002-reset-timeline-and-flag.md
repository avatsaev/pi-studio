# Task 002 — `resetTimeline` + `forkTimelineSync` feature flag

- **Sprint:** sprint-071-conversation-fork-daemon
- **Status:** done
- **Type:** feature
- **Area:** server/agent, protocol/capabilities
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** task-001

## Goal

Add the one daemon-internal entry point a fork needs — an unconditional in-memory timeline replace —
plus the server feature flag the web-client gates its fork UI on.

## Context / why

`agent-service.ts` today exposes `getTimeline`/`seedTimeline` only, and `seedTimeline` is
**deliberately a no-op when an in-memory store already exists**. A fork always happens on a live
session, which always has a store — so `seedTimeline` can never do the job. Hence a new, explicitly
unconditional entry point rather than a flag on the existing one.

The flag exists because an old daemon has the fork RPCs (sprint-037) but not this resync: forking
against it would strand every other connected client on the abandoned branch. The web-client must be
able to detect that and render no fork UI at all.

## Scope references

- `swe/features/conversation-fork.md` § New daemon-internal surface, § New server feature flag
- `packages/server/src/agent/agent-service.ts` — add `resetTimeline`
- `packages/server/src/agent/timeline-store.ts` — `AgentTimelineStore` (rows, epoch/seq, `startTurn`)
- `packages/protocol/src/client-capabilities.ts` — `SERVER_FEATURES` + `SERVER_FEATURE_COMPAT`
- `packages/protocol/src/client-capabilities.test.ts` — expected-keys list

## What to build

- Modify `packages/server/src/agent/agent-service.ts`:

  ```ts
  resetTimeline(agentId: string, rows: TimelineRow[]): void
  ```

  Unconditionally replaces the agent's in-memory timeline rows — unlike `seedTimeline`, it replaces
  even when a store already exists, and it accepts an **empty** `rows` array as a legitimate value
  (a fork to before the first user message hydrates to a near-empty branch). Subsequent live turns
  must append normally: `startTurn` continues from the hydrated max epoch, so numbering never
  collides with or rewinds below the rows just installed.

- Add `forkTimelineSync` to `SERVER_FEATURES` and a matching `SERVER_FEATURE_COMPAT` entry
  (`COMPAT({ name: "forkTimelineSync", addedIn: "<current version>", removeBy: "TBD" })`, matching
  the file's existing style), and add the key to `client-capabilities.test.ts`'s expected sorted list.

## Out of scope

- Calling `resetTimeline` from anywhere (task-003 wires it into `handleFork`).
- Emitting the `agent_timeline_reset` broadcast (task-003).

## Acceptance criteria

- [x] `resetTimeline` replaces rows on an agent that **already has** a populated in-memory store
      (demonstrating the contrast with `seedTimeline`, which no-ops in that situation).
- [x] `resetTimeline(agentId, [])` empties the store without throwing.
- [x] After a reset, the next `startTurn` produces epoch/seq numbering that continues from the
      installed rows' maximum — it does not restart at zero or collide with an installed row.
- [x] `server_info.features.forkTimelineSync` is advertised by both bootstraps.
- [x] Every `SERVER_FEATURES` key still has a COMPAT annotation (existing test enforces this).

## Test / verification plan

- Build: `npm run build:protocol && npm run build:server` succeeds.
- Tests: extend `packages/server/src/agent/` timeline/agent-service tests with the replace-semantics
  and epoch-continuation cases above; `npx vitest run packages/server/src/agent packages/protocol`
  all pass.
- Lint/format: `npm run lint`; `npx oxfmt <changed files>`.

## Notes

Keep `resetTimeline` free of any provider knowledge — it takes rows and installs them. Deciding
*whether* to reset (the handle-change guard) is task-003's job, deliberately kept out of here so this
entry point stays reusable by `/new`, `/resume`, `/clone` and `switch_session` later.
