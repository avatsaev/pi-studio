# Task 005 — Rewind UI (conversation & file time-travel)

- **Sprint:** sprint-021-timeline-composer-screens
- **Status:** backlog
- **Estimated size:** M
- **Depends on:** task-002, task-004; sprint-015/task-007 (rewind model + protocol/handler)

## Goal
Render the rewind affordance on user messages (conversation / files / both), drive the rewind mutation,
and apply post-rewind actions (e.g. restore the composer draft).

## Scope references
- `clean-room-scope/features/rewind.md`
- `clean-room-scope/features/agent-providers.md` (rewind capability flags — additive)

## What to build
- A rewind menu on eligible user-message rows (gated by the daemon rewind capability flags): options for
  conversation, files, both, from the sprint-015 `rewind.ts` `rewindMenuItems`.
- Wire the rewind mutation through the client (`agent.rewind.request`) with pending/confirm state; on
  success apply `postRewindActions` (truncate timeline before the message, optionally restore the
  rewound text into the composer draft).
- Confirmation dialog for destructive (files/both) rewinds; disable when unsupported.

## Out of scope
- Daemon-side revert mechanics (owned by sprint-015/task-007 / server scope). Timeline list (task-001).

## Acceptance criteria
- [ ] The rewind menu appears only when capabilities allow, offering the supported modes.
- [ ] Confirming a rewind issues the request, reflects pending state, and applies post-rewind actions.
- [ ] Files/both rewinds confirm destructively; unsupported modes are disabled.

## Test / verification plan
- Tests: menu items by capability flags; mutation state transitions; post-rewind actions (reuse
  sprint-015 `rewind.ts`).

## Notes
- Closes the timeline/composer sprint. TODO(verify): exact `agent.rewind.*` field names (sprint-015).
