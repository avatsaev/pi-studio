# Task 001 — Spike: capture every stage 1 frame from the dev daemon; promote the capture script to the recorder

- **Sprint:** sprint-083-external-client-fixtures
- **Status:** done
- **Type:** test
- **Area:** packages/server (scripts); swe/notes
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** none

## Goal

For each stage 1 row of the fixture table, we know whether the dev daemon can produce it through
its normal path, a missing mock recipe, or only a test hook. We also know the exact emitted shapes.
The capture script becomes the spec's optional recorder rather than throwaway code.

## Context / why

Five spec TODO(verify)s are about what the dev daemon actually emits. Planning found:
- the mock provider emits `turn_started`, `assistant_message`, `turn_completed`, `turn_canceled`,
  `queue_update`, `compaction` and (via `#tool`) `tool_call` plus partials;
- it has no visible producer for `reasoning`, `turn_failed`, `error`, or a `user_message` stream
  event;
- `agent_timeline_reset` comes only from `slash-command-operations.ts`'s `handleFork`, which needs
  a session whose persistence handle changes;
- `list_agents_request` is built inline in **both** bootstraps (`dev-bootstrap.ts:188`, and
  `bootstrap.ts`), so the two can drift.

Task-002 builds only what this spike proves is missing.

## Scope references

- swe/architecture/external-client-fixtures.md § Required fixture set (stage 1), § TODO(verify)
  (all five)
- packages/server/src/daemon/dev-bootstrap.ts (registrations :150-188, `DevBootstrapHandle` :55-65)
- packages/server/src/agent/providers/mock/mock-provider.ts, `tool-script.ts`
- packages/server/src/agent/slash-command-operations.ts (`handleFork`, reset branch)
- packages/server/src/ws/router.ts:132-139 (`pong`), packages/server/src/http/http-server.ts
  (`HEALTH_PATH`), packages/server/src/agent/session-operations.ts:69-81 (`interrupt_response`)
- packages/server/src/daemon/agent-ui-e2e.test.ts (raw `ws` harness pattern)

## What to build

- `packages/server/scripts/record-external-fixtures.ts`:
  - starts `startDevDaemon({host:"127.0.0.1", port:0})` in process;
  - drives the stage 1 scenario over a raw `ws` client;
  - prints each captured frame, grouped by type and variant.
  - With `--write <dir>` it writes candidate fixture files, never overwriting without `--force`.
  - Not run in CI.
- `swe/notes/external-client-fixtures-spike.md`:
  - one row per stage 1 fixture: producer (normal path, missing mock recipe, or test hook), the
    captured frame, volatile pointers;
  - the dev-vs-production `list_agents_response` field diff (from reading `bootstrap.ts`);
  - the `pong` and `GET /api/health` bodies;
  - whether `agent_update.model` is emitted by the dev daemon;
  - whether `agent_session_stats_request` is registered in the dev daemon;
  - a decision per gap.
- A recommendation on spec TODO #1 (ship `fixtures/` in the protocol package's npm `files`).

## Out of scope

- Writing the final fixtures (task-003/004) and adding producers (task-002).

## Acceptance criteria

- [ ] The note covers every stage 1 table row with a producer decision. No row is left "unknown".
- [ ] The recorder runs: `node --experimental-strip-types packages/server/scripts/record-external-fixtures.ts`
  (or the repo's existing script runner) prints frames and exits 0.
- [ ] Every one of the spec's five TODO(verify) items has an answer recorded, with evidence.

## Test / verification plan

- Run the recorder once and paste its output into the note.
- `npm run build:server`; `npm run lint`

## Notes

- If the production `list_agents_response` differs from the dev one in fields the dashboard reads,
  record it as a finding for the summary. Do not unify the handlers here; that is a separate
  decision.
