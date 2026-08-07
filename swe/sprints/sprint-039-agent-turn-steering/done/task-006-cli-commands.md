# Task 006 — CLI steer / follow-up commands

- **Sprint:** sprint-039-agent-turn-steering
- **Status:** done
- **Estimated size:** S
- **Depends on:** task-005

## Goal
Add `pi-studio agent steer <agentId> <message>` and `agent follow-up <agentId> <message>` commands
(with a top-level `steer` alias), and render the `queue_update` stream event in `attach`/`logs`.

## Background / why
The CLI's `send`/`stop` are one-shot; `attach` streams the live timeline read-only. Steering is a
one-shot fire-and-forget command against a running agent, matching the `send`/`stop` shape. The
`queue_update` event now flows through the stream and should render as a human-readable line
instead of falling to the JSON default.

## Scope references
- `packages/cli/AGENTS.md` § Agent commands
- `clean-room-scope/features/cli.md` § Agent command group

## What to build
In `packages/cli/src/agent-commands.ts`:
- Add `steer: "steer_agent_request"` and `followUp: "follow_up_agent_request"` to `AGENT_RPC`.
- Add a `steerAgent(client, ctx, agentId, message, opts, mode: "steer" | "followUp")` action:
  calls `client.agent(agentId).steer|followUp(message)`, prints `steered` / `queued follow-up` on
  `ok`, or `not delivered (no live turn)` on `ok:false`; JSON mode prints the raw payload. Returns
  a non-OK exit when `ok === false`.
- Register `agent steer <agentId> <message>` (+ top-level `steer` alias) and
  `agent follow-up <agentId> <message>`.
- Add a `queue_update` case to `formatStreamEvent` rendering a compact
  `~ queue [steering: …; follow-up: …]` (or `empty`) line.

## Out of scope
- Interactive steering inside `attach` (typed live input) — one-shot commands + read-only render only.
- web-client (task-007).

## Acceptance criteria
- [ ] `steer`/`follow-up` commands issue the right RPC and print outcome per `ok`.
- [ ] `formatStreamEvent` renders `queue_update` as a readable line (not JSON).
- [ ] `npm run build:cli` + `npm run typecheck` pass.

## Test / verification plan
- Extend `agent-commands.test.ts` (fake daemon transport):
  - `steer` maps to `steer_agent_request` with `agentId` + `message`.
  - `follow-up` maps to `follow_up_agent_request`.
  - `formatStreamEvent` renders a `queue_update` (populated and empty).
- `npx vitest run packages/cli/src/agent-commands.test.ts`.
