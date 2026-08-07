# Task 001 — Project/workspace registries + key derivation + reconciliation — Summary

- **Sprint:** sprint-008-projects-worktrees-git
- **Completed:** 2026-06-11
- **Status:** done

## What was implemented
`packages/server/src/projects/`:
- **`workspace-registry.ts`** — `WorkspaceRegistryService` over `projects/projects.json` +
  `projects/workspaces.json` (the array schemas already existed in `entity-schemas.ts`):
  - `deriveProjectKey({remote?, rootPath})` → `remote:<host/owner/repo>` when a remote exists, else
    `path:<normalized rootPath>`. `normalizeRemote()` handles https / scp-like (`git@host:o/r`) /
    `ssh://` forms (strips scheme, user, `:port`, `.git`, lowercases). `normalizePath()` strips
    trailing separators.
  - `normalizeWorkspaceKind()` maps legacy wire `checkout` → `local_checkout`; keeps
    `local_checkout|worktree|directory`; unknown → `directory` (never persists `checkout`).
  - `resolveOrCreateProject()` reuses by exact key and by normalized `rootPath` (active git projects
    unique by rootPath). `resolveOrCreateWorkspace()` reuses an active workspace for the same cwd.
  - `archiveWorkspace()` sets `archivedAt` + `updatedAt`; active-list accessors filter archived.
- **`reconciliation.ts`** — `reconcileRegistries(home)`: groups active projects by normalized
  rootPath; for duplicates picks a canonical (remote-keyed preferred, else oldest `createdAt`),
  migrates the duplicates' active workspaces onto it, and archives the emptied duplicates. Returns
  `{ archivedProjectIds, migratedWorkspaceIds }`.
- **`index.ts`** re-exports both; wired into `packages/server/src/index.ts`.

## Files created / changed
| File | Change |
|------|--------|
| `packages/server/src/projects/workspace-registry.ts` | created |
| `packages/server/src/projects/reconciliation.ts` | created |
| `packages/server/src/projects/index.ts` | created |
| `packages/server/src/index.ts` | modified (re-export projects) |
| `packages/server/src/projects/workspace-registry.test.ts` | added — 8 tests |
| `packages/server/src/projects/reconciliation.test.ts` | added — 3 tests |

## Build & test results
```
$ npm run build:server         → exit 0
$ npx vitest run packages/server/src/projects/   → 11 passed (2 files)
$ npx oxlint packages/server/src/projects        → clean
$ npx oxfmt --check packages/server/src/projects → clean
```

## Acceptance criteria
- [x] A git project derives a remote-based `projectKey` (`remote:github.com/acme/widgets`).
- [x] Two registrations of the same normalized `rootPath` resolve to one project.
- [x] Startup reconciliation migrates workspaces off duplicates and archives the empties
      (remote-keyed preferred; oldest path-keyed wins otherwise).
- [x] Archiving a workspace sets `archivedAt` and removes it from active lists.

## Follow-ups / TODO(verify)
- Exact `workspace_update` payload fields (task-002 broadcasts them).
- Tests use temp `$PI_STUDIO_HOME` dirs over the real file-backed accessors.
