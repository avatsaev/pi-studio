# Task 001 — Protocol: schemas for send and the two "accepted" answers

- **Sprint:** sprints/sprint-151-instant-replies-daemon
- **Status:** done
- **Type:** feature
- **Area:** packages/protocol (messages)
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** none

## Goal
`send_agent_prompt` and `agent_prompt_response` exist as real schemas, and both answers say "accepted",
not "finished".

## Context / why
Finding A7 as re-read on 2026-11-25. The send request and its answer have no schema in the protocol
package: the answer `{type: "agent_prompt_response", agentId, status: "idle"}` is a literal in
`agent-service.ts`, and `status: "idle"` is sent even when the turn failed. M4 changes both answers to
mean "the request was accepted", so the shape is pinned here first. No feature flag and no
compatibility path (owner rule, 2026-11-22).

## Scope references
- `docs/daemon-audit-handoff.md` § "M4 contract: create and send answer at once" (points 1, 4, 6), § A7
- `packages/protocol/src/messages.ts` (`createAgentRequestSchema` :186-203, `createAgentResponseSchema`
  :205-210, `sessionMessageSchema` union, `steer_agent_request` :827-847 as the neighbour to copy)
- `packages/protocol/src/session-messages.test.ts` (:109-150), `messages.envelopes.test.ts`
- `packages/protocol/AGENTS.md`

## What to build
- `sendAgentPromptRequestSchema`: `{type: "send_agent_prompt", requestId, agentId, prompt,
  clientMessageId?, images?}` (`images` has the shape `create_agent_request` already uses; passthrough
  like its neighbours).
- `agentPromptResponseSchema`: `{type: "agent_prompt_response", requestId, payload: {agentId}}`
  (payload passthrough). No `status` field.
- Both join `sessionMessageSchema`, with exported types. `create_agent_response` keeps its shape; its
  doc comment and the new ones state the contract: the answer means the request was accepted, and the
  outcome arrives as `agent_stream` rows and one `agent_update`.
- `packages/protocol/AGENTS.md`: the two schemas and the contract sentence.

## Out of scope
The daemon's behaviour (task-002, task-003). External fixtures (task-004). A turn id: `turnId` on the
`turn_*` events stays optional and untouched.

## Acceptance criteria
- [ ] A valid send request and a valid answer parse through `sessionMessageSchema`; a send without
      `agentId` or `prompt` is rejected.
- [ ] An answer that still carries `status` parses (passthrough) but the type has no `status` member.
- [ ] Existing protocol tests pass; the `SERVER_FEATURES` key list is unchanged.

## Test / verification plan
- `npx vitest run packages/protocol`
- `npm run build:protocol`

## Notes
The daemon's router does not validate inbound messages against the union today (finding T4, M6), so
adding the schemas changes no runtime behaviour.
