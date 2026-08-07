# Task 001 — Draft persistence & submission pipeline

- **Sprint:** sprint-025-composer-full
- **Status:** done
- **Estimated size:** L
- **Depends on:** sprint-024, sprint-015/task-006 (composer models)

## Goal
Wire the composer to real draft persistence (IndexedDB via KV store) and the full submission
pipeline (create-or-continue decision, optimistic append, error recovery).

## Scope references
- `clean-room-scope/features/composer-ui.md` § draft persistence, § submission
- `clean-room-scope/features/agent-sessions.md` § user message submission

## What to build
- **Draft store integration**: `useDraft(workspaceId)` hook that loads/saves draft text + attachments
  to IndexedDB on every change (debounced 300ms). Draft survives page refresh, tab switch, app
  restart. Clear draft on successful submission.
- **Submission pipeline**: on Enter/submit-button, run `resolveSubmitDecision()` → if "submitted",
  call `agent.message.send` RPC via client; if "queued", append to pending queue store.
  Optimistically append user message to timeline store; on RPC error, show toast + restore draft.
- **Queue indicator**: when agent is running, show "queued" badge on submit button; queued messages
  auto-send when agent becomes idle (subscribe to status change).
- **Create-or-continue**: if no active agent in workspace, submission triggers agent creation first
  (from new-workspace flow); if agent exists, continue conversation.
- **Processing lock**: while submission RPC is in-flight, lock composer (prevent double-submit);
  show spinner on send button.

## Acceptance criteria
- [ ] Typing in composer persists to IndexedDB; refreshing the page restores the draft.
- [ ] Submitting sends via RPC, appends optimistically, clears draft on success.
- [ ] Queue: message queued while agent running; auto-sent when agent becomes idle.
- [ ] Error: failed RPC shows toast, restores draft, removes optimistic message.

## Test / verification plan
- Persistence: type → refresh → verify draft restored from KV.
- Submit: mock successful RPC → verify draft cleared + optimistic message remains.
- Queue: set agent running → submit → verify queued → set idle → verify sent.
- Error: mock RPC failure → verify toast + draft restored.
