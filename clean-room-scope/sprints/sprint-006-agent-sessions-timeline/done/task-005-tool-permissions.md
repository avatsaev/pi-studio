# Task 005 — Tool-call permission flow + question bridge

- **Sprint:** sprint-006-agent-sessions-timeline
- **Status:** done
- **Estimated size:** M
- **Depends on:** task-002

## Goal
Implement the tool-call permission request/resolve protocol and the question-permission bridge for
Pi's interactive dialogs.

## Scope references
- `clean-room-scope/features/tool-permissions.md` § Flow messages, § Behavior, § Question-permission bridge
- `clean-room-scope/features/agent-providers.md` § Extension UI dialogs → question permissions

## What to build
- When the mode requires approval, a tool call creates an `AgentPermissionRequest(requestId)`, flags
  the agent as awaiting input, and broadcasts `agent_permission_request` to all subscribers; the turn
  WAITS for `respondToPermission(requestId, response)`.
- On response: apply to the provider session; broadcast `agent_permission_resolved`; clear the flag;
  resume/skip/deny. First resolution wins across clients.
- Full-access modes emit no requests; ask-style modes do (per `colorTier`).
- Question bridge: Pi `select`/`input`/`editor`/`confirm` surface as question permissions answered via
  `extension_ui_response`. A `select` with `allowComment:true` is one combined question: answer the
  `select` then auto-answer the follow-up optional comment `input` (supplied comment or empty).
- Preserve optional/skip vs. cancel-whole-dialog semantics; ignore fire-and-forget UI (notifications).

## Out of scope
- MCP/CLI permission mirrors (sprint-010/011). UI rendering (sprint-012).

## Acceptance criteria
- [ ] A tool call in ask-mode emits `agent_permission_request` and pauses the turn.
- [ ] Responding resolves it and broadcasts `agent_permission_resolved`; first resolution wins.
- [ ] Full-access mode produces no permission requests.
- [ ] A Pi `select`+optional-comment dialog is one question and auto-resolves the follow-up input.
- [ ] Interrupting a turn cancels its pending request.

## Test / verification plan
- Tests: `npx vitest run .../permissions.test.ts` using a scripted provider — ask flow, full-access
  no-op, combined select+comment, interrupt-cancels-pending.

## Notes
- Response option vocabulary + payload field names are TODO(verify).
