# Task 008 — Docs + full-suite verification

- **Sprint:** sprint-039-agent-turn-steering
- **Status:** done
- **Estimated size:** S
- **Depends on:** task-001, task-002, task-003, task-005, task-006, task-007

## Goal
Update the package docs to describe steering, and verify the whole workspace builds/typechecks and
the full test suite passes.

## Background / why
Docs are deliverables in this repo (root `AGENTS.md` § Docs sync). Steering touches protocol, server,
client, cli, and web-client, so each package's `AGENTS.md` needs the new surface recorded.

## Scope references
- Root `AGENTS.md` § Docs sync on code changes
- `clean-room-scope/features/agent-sessions.md`, `features/composer-ui.md`,
  `features/timeline-rendering.md`

## Already done (server-side sprint, tasks 001–006)
These `AGENTS.md` files were updated when the daemon/SDK/CLI work landed — do NOT re-touch unless
their content is now wrong:
- `packages/protocol/AGENTS.md` — schema table has `steerAgentRequest/Response`,
  `followUpAgentRequest/Response`, and the `queue_update` `AgentStreamEvent` variant. ✅
- `packages/server/AGENTS.md` — documents `AgentSession.steer`/`followUp` + `supportsSteering`, the
  `steer_agent_request`/`follow_up_agent_request` handlers (live-session-direct, no `runTurn`, no
  status change), and the updated `session-operations.ts` layout line. ✅
- `packages/client/AGENTS.md` — `steer`/`followUp` in the agent-handle method table. ✅
- `packages/cli/AGENTS.md` — `steer` / `follow-up` commands in the command table. ✅

## Remaining work
- **`packages/web-client/AGENTS.md`**: document the Composer Send↔Steer mode swap, that steer reuses
  the optimistic-echo path, and the `queued` badge lifecycle driven by `queue_update`. (Depends on
  task-007 landing.)
- **Clean-room scope**: add a § Steering to `features/agent-sessions.md` and a § Steering to
  `features/composer-ui.md`; note the `queue_update` event in `features/timeline-streaming.md` /
  `features/timeline-rendering.md`.

## Out of scope
- Any behavior change (docs + verification only).

## Acceptance criteria
- [ ] Each listed `AGENTS.md` reflects the shipped steering surface (no aspirational claims).
- [ ] `npm run build` + `npm run typecheck` + `npm run lint` clean (no new warnings from touched files).
- [ ] `npx vitest run` (full suite) passes.

## Test / verification plan
- `npm run build && npm run typecheck && npm run lint`.
- `npx vitest run` — full suite green.
