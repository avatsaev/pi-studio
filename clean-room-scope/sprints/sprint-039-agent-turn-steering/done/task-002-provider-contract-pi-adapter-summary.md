# Task 002 Summary — Provider contract + Pi adapter steering

- **Status:** done
- **Verified:** `npm run build:server`, `npm run typecheck`, `npx vitest run packages/server/src/agent/providers/pi/pi-adapter.test.ts` (green).

## What was implemented
- **`provider-contract.ts`**: added `SteerOptions { images?: ImageAttachment[] }` and optional
  `steer?(message, opts?)` / `followUp?(message, opts?)` on `AgentSession` (documented as
  fire-and-forget, live-turn injection, confirmed via `queue_update`).
- **`providers/pi/agent.ts`** (`PiAgentSession`):
  - `PI_CAPABILITIES.supportsSteering = true`.
  - Extracted the client→Pi `ImageContent` conversion into a shared private `toPiImages` helper,
    reused by `startTurn`, `steer`, `followUp`.
  - `steer` → `transport.notify("steer", { message, images? })`; `followUp` →
    `transport.notify("follow_up", { message, images? })`.
- **`providers/pi/event-mapper.ts`**: `queue_update` now maps to
  `{ kind: "queue_update", steering, followUp }` (string-filtered, default empty); removed from the
  ignored-cases list.

## Deviations from the task spec
- None.

## Tests
- `pi-adapter.test.ts`: fake transport fires `queue_update` on `steer`/`follow_up`; asserts the
  correct notify command AND the mapped `queue_update` reaching subscribers; plus direct
  `mapPiEvent` cases for populated and empty `queue_update`.
