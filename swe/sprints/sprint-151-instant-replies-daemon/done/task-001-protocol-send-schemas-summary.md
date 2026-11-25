# Task 001 — Protocol: schemas for send and the two "accepted" answers — Summary

- **Sprint:** sprints/sprint-151-instant-replies-daemon
- **Completed:** 2026-11-25
- **Status:** done

## What was implemented
`sendAgentPromptRequestSchema` (`send_agent_prompt`: `agentId`, `prompt`, `clientMessageId?`, `images?`) and `agentPromptResponseSchema` (`agent_prompt_response`: `payload: {agentId}`, no `status`) joined `sessionMessageSchema`; the "accepted, not finished" contract is stated on both responses and on `create_agent_response`.

## Files changed
`packages/protocol/src/messages.ts`, `session-messages.test.ts`, `packages/protocol/AGENTS.md`.

## Build & test results
```
npx vitest run packages/protocol -> 14 files, 342 passed; npm run build:protocol OK; oxfmt/oxlint clean
Wave gate (full tree): build, typecheck 0 errors; lint 0 errors; npm test 331 files, 4750 tests passed
```

## Acceptance criteria
- [x] Valid send and answer parse; a send without `agentId` or `prompt` is rejected
- [x] An answer with a stray `status` parses, the type has no `status` member
- [x] Existing tests pass; `SERVER_FEATURES` keys unchanged
