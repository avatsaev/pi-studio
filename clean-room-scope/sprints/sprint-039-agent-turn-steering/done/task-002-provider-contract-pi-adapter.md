# Task 002 — Provider contract + Pi adapter steering

- **Sprint:** sprint-039-agent-turn-steering
- **Status:** done
- **Estimated size:** S
- **Depends on:** task-001

## Goal
Extend the provider-neutral `AgentSession` contract with optional `steer`/`followUp` methods,
implement them in the Pi adapter (Pi RPC `steer`/`follow_up`), and map Pi's `queue_update` event
into the new provider-neutral stream event.

## Background / why
`packages/server/src/agent/provider-contract.ts` is the only agent surface the rest of the daemon
touches, so steering must be expressed there before any handler can call it. The Pi adapter already
sends `prompt` (fire-and-forget notify) and `abort`; `steer`/`follow_up` are the same style of
fire-and-forget notify over the same stdio transport, safe to send concurrently with a running turn.

## Scope references
- `packages/server/AGENTS.md` § AgentClient / AgentSession, § Pi provider
- `clean-room-scope/features/agent-providers.md` § AgentSession, § Capability flags
- Pi RPC contract: `docs/rpc.md` §§ Prompting (`steer`/`follow_up`), Events (`queue_update`)

## What to build
- **`provider-contract.ts`**:
  - Add `SteerOptions { images?: ImageAttachment[] }`.
  - Add optional `steer?(message, opts?): Promise<void>` and `followUp?(message, opts?): Promise<void>`
    to `AgentSession` (present only when `capabilities.supportsSteering`). Document them as
    fire-and-forget, injected into a LIVE turn, confirmed asynchronously via `queue_update`.
- **`providers/pi/agent.ts`** (`PiAgentSession`):
  - Set `supportsSteering: true` in `PI_CAPABILITIES`.
  - Extract the existing `prompt` image-conversion (client `{mimeType,data}` → Pi `ImageContent`
    `{type:"image",data,mimeType}`) into a shared private helper reused by `startTurn`, `steer`,
    `followUp`.
  - Implement `steer` → `transport.notify("steer", { message, images? })`;
    `followUp` → `transport.notify("follow_up", { message, images? })`.
- **`providers/pi/event-mapper.ts`**: map `queue_update` (currently dropped/ignored) to
  `{ kind: "queue_update", steering: string[], followUp: string[] }` (filter to string arrays,
  default empty). Remove it from the ignored-cases list.

## Out of scope
- Daemon RPC handlers (task-003), mock provider (task-004), SDK/CLI (005/006), web-client (007).

## Acceptance criteria
- [ ] `AgentSession.steer?`/`followUp?` + `SteerOptions` in the contract; `supportsSteering: true`
  on Pi.
- [ ] Pi adapter sends `steer`/`follow_up` notifies with correctly-converted images; image helper
  shared with `startTurn`.
- [ ] `queue_update` maps to the new event kind; no other mapper behavior changed.
- [ ] `npm run build:server` and `npm run typecheck` pass.

## Test / verification plan
- Extend `providers/pi/pi-adapter.test.ts`:
  - The fake transport fires a `queue_update` on `steer`/`follow_up`; assert `steer`/`followUp`
    send the right notify command AND the mapped `queue_update` event surfaces to subscribers.
  - `mapPiEvent({type:"queue_update", steering:[...], followUp:[...]})` maps to the new kind; an
    empty `queue_update` maps to empty arrays.
- `npx vitest run packages/server/src/agent/providers/pi/pi-adapter.test.ts`.

## Notes
- Keep `steer`/`followUp` fire-and-forget (return resolved Promise) — Pi confirms only via
  `queue_update`, never a synchronous result.
