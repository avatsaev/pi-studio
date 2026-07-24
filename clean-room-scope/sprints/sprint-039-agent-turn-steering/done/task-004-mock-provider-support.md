# Task 004 — Mock provider steering support

- **Sprint:** sprint-039-agent-turn-steering
- **Status:** done
- **Estimated size:** S
- **Depends on:** task-002

## Goal
Teach the in-process `mock` provider to accept `steer`/`followUp` and emit a deterministic
`queue_update` event, so daemon handler tests (task-003) and any client-side tests have a
credentials-free, timing-free steering path.

## Background / why
The `mock` provider implements the `AgentClient`/`AgentSession` contracts in memory and is the only
provider used in tests. It must support the new optional steering surface so the daemon handler and
event flow can be exercised without spawning a real Pi process.

## Scope references
- `packages/server/AGENTS.md` § Providers (mock)
- `clean-room-scope/features/agent-providers.md` § Provider entry (mock, dev/test only)

## What to build
In `packages/server/src/agent/providers/mock/mock-provider.ts` (`MockAgentSession`):
- Set `supportsSteering: true` in `MOCK_CAPABILITIES`.
- Add in-memory `steeringQueue` / `followUpQueue` string arrays.
- Implement `steer(message)` → push to `steeringQueue`, emit
  `{ kind: "queue_update", steering: [...], followUp: [...] }`.
- Implement `followUp(message)` → push to `followUpQueue`, emit the same event shape.
- No delivery-timing simulation — the queue reflection is the deterministic signal tests assert on.

## Out of scope
- Real Pi behavior (task-002 covers the adapter), handlers (task-003).

## Acceptance criteria
- [ ] `MOCK_CAPABILITIES.supportsSteering === true`.
- [ ] `steer`/`followUp` emit a `queue_update` reflecting the current pending queue.
- [ ] `npm run build:server` + `npm run typecheck` pass.

## Test / verification plan
- Covered by task-003's `session-ops.test.ts` (mock is the vehicle) and any additions to
  `mock-provider.test.ts` asserting the emitted `queue_update`.
- `npx vitest run packages/server/src/agent/providers/mock/mock-provider.test.ts`.
