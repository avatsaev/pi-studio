# Task 001 — Project/workspace registries + key derivation + reconciliation

- **Sprint:** sprint-008-projects-worktrees-git
- **Status:** done
- **Estimated size:** M
- **Depends on:** task-004 (sprint-003), task-005 (sprint-005)

## Goal
Implement the project and workspace registries with `projectKey` derivation and startup
reconciliation.

## Scope references
- `clean-room-scope/features/projects-workspaces.md` § Registries, § Project key derivation, § Startup reconciliation
- `clean-room-scope/architecture/persistence.md` § Project/Workspace registry

## What to build
- `workspace-registry.ts` over `projects/projects.json` + `projects/workspaces.json` (arrays;
  `archivedAt` soft-delete).
- `projectKey`: git remote present → normalized remote (e.g. `remote:github.com/owner/repo`); else
  normalized `mainRepoRoot`/`rootPath`. Active git projects unique by normalized `rootPath`.
- Reconciliation service: move workspaces off duplicate path-keyed projects onto the canonical
  (prefer remote-keyed ids), archive the emptied duplicates. Runs at startup.
- Workspace kinds: `local_checkout | worktree | directory` (accept legacy `checkout` on the wire,
  not persisted).

## Out of scope
- Open-project flow + wire RPCs (task-002). Worktrees (task-003). Git ops (task-004+).

## Acceptance criteria
- [ ] A git project derives a remote-based `projectKey`.
- [ ] Two registrations of the same normalized `rootPath` resolve to one project.
- [ ] Startup reconciliation migrates workspaces off duplicates and archives the empties (remote-keyed preferred).
- [ ] Archiving a workspace sets `archivedAt` and removes it from active lists.

## Test / verification plan
- Tests: `npx vitest run .../workspace-registry.test.ts`, `.../reconciliation.test.ts` — key
  derivation, dedup, reconcile/archive.

## Notes
- Exact `workspace_update` payload fields are TODO(verify).
