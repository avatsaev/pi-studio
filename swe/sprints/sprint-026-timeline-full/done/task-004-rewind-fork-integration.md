# Task 004 — Rewind & fork-context integration

- **Sprint:** sprint-023-timeline-full
- **Status:** done
- **Estimated size:** M
- **Depends on:** tasks 001–003; sprint-021/task-005 (rewind UI)

## Goal
Wire the rewind menu and fork-context menu to real daemon RPCs, and handle the post-rewind
timeline truncation and composer restore flow.

## Scope references
- `clean-room-scope/features/rewind.md`
- `clean-room-scope/features/composer-ui.md` § fork context

## What to build
- **Rewind RPC integration**: when user confirms rewind, call `agent.rewind.request` with message
  ID and mode (conversation/files/both). On success: truncate timeline items after the rewound
  message in the session store; optionally restore the rewound message text into composer draft.
- **Fork-context menu**: on assistant messages, offer "Fork from here" → creates a new agent
  session forking context from this point; navigates to new workspace. Uses `agent.create` with
  `forkFrom` parameter.
- **Rewind capability gating**: only show rewind menu when daemon advertises the capability flag
  (per agent provider). Different providers may support different rewind modes.
- **Confirmation with file revert warning**: files/both mode shows a destructive confirmation
  dialog explaining which files will be reverted; list affected file paths if available.
- **Post-rewind actions**: `refetch-tail` re-fetches the timeline from the rewind point;
  `restore-composer` inserts text into draft.

## Acceptance criteria
- [ ] Rewind menu only visible when capability advertised; correct modes shown.
- [ ] Confirming conversation rewind: RPC succeeds → timeline truncated → draft restored.
- [ ] Files/both rewind shows destructive confirmation with file list.
- [ ] Fork-context creates new session and navigates to it.

## Test / verification plan
- Rewind: mock successful RPC → verify timeline truncated at message.
- Draft restore: verify composer draft contains rewound message text.
- Fork: mock create RPC → verify navigation to new workspace.
- Capability gating: mock provider without rewind → verify menu hidden.
