# Task 004 — Subagents track + tab-vs-archive client rules

- **Sprint:** sprint-012-app-runtime-ui
- **Status:** backlog
- **Estimated size:** S
- **Depends on:** task-003

## Goal
Implement the client-side subagents track and the rules that decouple "close tab" from "archive".

## Scope references
- `clean-room-scope/features/subagents.md` § Track membership rule, § Behavior, § Surfaces
- `clean-room-scope/architecture/agent-lifecycle.md` § Tabs vs. archive

## What to build
- Subagents track component (collapsible lane above the composer in the parent's pane):
  membership = `parentAgentId === parent.id && !archivedAt`.
- Row archive button (X) → confirm → archive that subagent (global; propagates to all clients).
- Tab close behavior: subagent tab close is **layout-only** (stays unarchived, stays in track,
  re-openable); root-agent tab close **archives** (confirm if running).
- Tabs are per-client layout (not persisted globally).

## Out of scope
- Server cascade/label logic (already in sprint-005). Track ordering/collapse persistence.

## Acceptance criteria
- [ ] A non-detached child appears in its parent's track and disappears when archived.
- [ ] Closing a subagent tab does not archive it; closing a root-agent tab does.
- [ ] The track shows exactly `parentAgentId === parent.id && !archivedAt`.
- [ ] The row archive button archives the subagent on all connected clients.

## Test / verification plan
- Tests: `npx vitest run packages/app/.../subagents-track.test.ts` — membership filter, tab-close vs
  archive branching, archive propagation (mock client).

## Notes
- Whether detached/handoff agents ever surface in any track is TODO(verify).
