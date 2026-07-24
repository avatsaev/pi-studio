# Task 006 Summary — CLI steer / follow-up commands

- **Status:** done
- **Verified:** `npm run build:cli`, `npm run typecheck`, `npx vitest run packages/cli/src/agent-commands.test.ts` (green).

## What was implemented
In `packages/cli/src/agent-commands.ts`:
- `AGENT_RPC.steer = "steer_agent_request"`, `AGENT_RPC.followUp = "follow_up_agent_request"`.
- `steerAgent(client, ctx, agentId, message, opts, mode: "steer" | "followUp")`: calls
  `client.agent(id).steer|followUp(message)`; prints `steered` / `queued follow-up` on `ok`,
  `not delivered (no live turn)` on `ok:false`; JSON mode prints the raw payload; returns
  `EXIT_ERROR` when `ok === false`.
- Registered `agent steer <agentId> <message>` (+ top-level `steer` alias) and
  `agent follow-up <agentId> <message>`.
- `formatStreamEvent` renders a `queue_update` as `~ queue [steering: …; follow-up: …]` (or
  `~ queue [empty]`).

## Deviations from the task spec
- None. Interactive-attach steering was intentionally out of scope; only one-shot commands + the
  read-only `queue_update` render landed.

## Tests
- `agent-commands.test.ts`: `steer` maps to `steer_agent_request` (agentId + message); `follow-up`
  maps to `follow_up_agent_request`; `formatStreamEvent` renders populated and empty `queue_update`.
