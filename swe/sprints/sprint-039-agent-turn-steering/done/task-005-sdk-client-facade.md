# Task 005 — SDK client facade steer/followUp

- **Sprint:** sprint-039-agent-turn-steering
- **Status:** done
- **Estimated size:** S
- **Depends on:** task-001

## Goal
Add `steer(message, opts?)` and `followUp(message, opts?)` to the agent-scoped handle on
`PiStudioClient`, so CLI and web-client call one SDK method instead of raw RPCs.

## Background / why
`packages/client/src/pistudio-client.ts` exposes an agent handle (`client.agent(id)`) whose method
names mirror the daemon RPC types (`send`, `interrupt`, `update`, …). Steering is the same style of
fire-and-forget agent operation and belongs on that handle.

## Scope references
- `packages/client/AGENTS.md` § Agent handle methods
- `clean-room-scope/architecture/client-app-runtime.md` § PiStudioClient facade

## What to build
In `packages/client/src/pistudio-client.ts`:
- Add to the agent-handle interface and implementation:
  - `steer(message: string, opts?: { clientMessageId?: string; images?: unknown[] }): Promise<unknown>`
    → `daemon.request("steer_agent_request", { agentId, message, clientMessageId, images })`.
  - `followUp(message: string, opts?: { clientMessageId?: string; images?: unknown[] }): Promise<unknown>`
    → `daemon.request("follow_up_agent_request", { agentId, message, clientMessageId, images })`.
- Document them in the handle's method-name table (mirror `send`/`interrupt`).

## Out of scope
- CLI (task-006), web-client (task-007).

## Acceptance criteria
- [ ] `steer`/`followUp` on both the interface and impl; images + clientMessageId forwarded.
- [ ] `npm run build` (client) + `npm run typecheck` pass; built `.d.ts` exports the methods.

## Test / verification plan
- If the SDK facade has unit tests, add coverage that `steer`/`followUp` issue the correct RPC
  type with the right params; otherwise rely on the CLI test (task-006) exercising the built SDK.
- `npm run typecheck`.
