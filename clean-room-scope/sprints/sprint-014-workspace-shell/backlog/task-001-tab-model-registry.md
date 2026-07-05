# Task 001 — Tab model, panel registry & reconciliation

- **Sprint:** sprint-014-workspace-shell
- **Status:** backlog
- **Estimated size:** M
- **Depends on:** task-001 (sprint-013, host runtime/routing)

## Goal
Implement the workspace tab model, the kind→UI panel registry, subagents tab/archive policy, and backend reconciliation.

## Scope references
- `clean-room-scope/features/workspace-ui.md` § Tab model, § Reconciliation, § Per-client layout vs.
  global archive
- `clean-room-scope/features/subagents.md`

## What to build
- Tab + descriptor types; the six tab kinds with deterministic ids (re-open re-focuses; draft→agent
  retarget in place); target normalization/equality (draft setup participates).
- The panel registry (`kind → component, useDescriptor, confirmClose?`); descriptor drives label/icon/
  status-dot + loading skeleton title.
- Pane context + pane focus context contracts passed to panels.
- The tab reconciler: de-dup, collapse stale (post-hydration), add missing (auto-open agents / standalone
  terminals), apply per-client pin/hide; workspace membership by normalized cwd; archived-agent tab
  pruning on all clients.
- Subagents policy: root-agent tab close is global archive; subagent tab close is layout-only unless
  explicitly archived; cascade archive behavior follows `features/subagents.md`.

## Out of scope
- Pane/split layout + DnD (task-002). Workspace screen composition + headers (task-003). Seeding/gating
  (task-004). Panel component internals (sprints 016–017).

## Acceptance criteria
- [ ] Re-opening an existing target re-focuses its tab; a draft tab becomes an agent tab in place.
- [ ] Reconciliation de-dups, prunes archived/stale tabs after hydration, and auto-opens the right tabs.
- [ ] Pin forces visible; hide suppresses; both are per-client.
- [ ] Subagent tab close/archive behavior follows the documented layout-only vs global archive policy.

## Test / verification plan
- Tests: deterministic-id + equality; reconciler de-dup/collapse/add with a snapshot; pin/hide application.

## Notes
- Runtime division of labor between the layout store and the flat tabs store is TODO(verify).
