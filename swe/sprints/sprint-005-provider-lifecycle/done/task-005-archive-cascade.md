# Task 005 — Archive (soft delete) + cascade

- **Sprint:** sprint-005-provider-lifecycle
- **Status:** done
- **Estimated size:** S
- **Depends on:** task-004

## Goal
Implement global soft-delete archive with recursive cascade to non-detached children.

## Scope references
- `clean-room-scope/architecture/agent-lifecycle.md` § Archive (soft delete, global), § Subagents vs. detached
- `clean-room-scope/features/subagents.md` § Track membership rule

## What to build
- `archiveAgent(id)`: snapshot session into the registry; set `archivedAt = now`; normalize
  `lastStatus` away from running/initializing; notify subscribers (`agent_archived`); close the
  runtime (kill the process if running); then cascade — for each agent with
  `labels["pi-studio.parent-agent-id"] == id`, `archiveAgent(child.id)` recursively.
- Detached agents (no parent label) are not archived by a parent's archive.
- Record stays on disk with `archivedAt`; disappears from active lists.

## Out of scope
- `autoArchive` on terminal turn (sprint-006). Worktree archive coupling (sprint-008). Client tab rules (sprint-012).

## Acceptance criteria
- [ ] Archiving a parent cascades to all parent-agent-id-linked non-detached children recursively.
- [ ] A detached child (no parent label) survives the parent's archive.
- [ ] Archiving a running agent closes/kills its runtime and normalizes `lastStatus`.
- [ ] Archived agents are excluded from active lists but remain on disk.

## Test / verification plan
- Tests: `npx vitest run .../archive.test.ts` — cascade tree, detached survival, running-agent kill,
  active-list exclusion.

## Notes
- Archive is the single global lifecycle gesture; client "close tab" semantics are layered later.
