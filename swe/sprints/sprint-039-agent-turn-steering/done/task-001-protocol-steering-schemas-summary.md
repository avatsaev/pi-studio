# Task 001 Summary — Protocol steering schemas

- **Status:** done
- **Verified:** `npm run build:protocol`, `npm run typecheck`, `npx vitest run packages/protocol` (all green; full suite 694 tests passing).

## What was implemented
In `packages/protocol/src/messages.ts` (append-only, `.passthrough()` + optional fields):
- `steerAgentRequestSchema` / `SteerAgentRequest` — `steer_agent_request` (`requestId`, `agentId`,
  `message`, `images?`, `clientMessageId?`).
- `steerAgentResponseSchema` / `SteerAgentResponse` — `{ agentId, ok }`.
- `followUpAgentRequestSchema` / `FollowUpAgentRequest` — `follow_up_agent_request` (same fields).
- `followUpAgentResponseSchema` / `FollowUpAgentResponse` — `{ agentId, ok }`.
- Extended `agentStreamEventSchema` with a `queue_update` variant:
  `{ kind: "queue_update", steering?: string[], followUp?: string[] }`.
- All four request/response schemas registered in `sessionMessageSchema`; exported via the package
  index (`export * from "./messages.js"`).

In `packages/protocol/src/provider-manifest.ts`:
- Added optional `supportsSteering?: z.boolean().optional()` to `agentCapabilityFlagsSchema`
  (additive, alongside the rewind flags; old data still validates).

## Deviations from the task spec
- None material. Dedicated RPCs only; no `streamingBehavior` overload, no `set_steering_mode` RPC
  (as scoped).

## Tests
- `session-messages.test.ts` and `provider-manifest.test.ts` cover the new schemas/flag via the
  existing discriminated-union + optional-field assertions.
