# Projects & Workspaces — Clean Room Scope

> Part of: [MAIN-SCOPE.md](../MAIN-SCOPE.md)
> Related scopes: [worktrees.md](worktrees.md), [git-checkout.md](git-checkout.md),
> [../architecture/persistence.md](../architecture/persistence.md),
> [../architecture/client-app-runtime.md](../architecture/client-app-runtime.md)

## Purpose

A **project** is a logical grouping of workspaces sharing a git remote (or main repo root). A
**workspace** is one concrete `cwd` on one daemon, with git state, belonging to exactly one project.
Projects are auto-detected from the filesystem and tagged by git remote when available. This feature
covers the project/workspace registries, reconciliation, opening projects, and archive.

## Public Contract

### Terminology (authoritative)
- **Project** (`ProjectSummary`, `projectKey`) — not "repo/repository" in UI.
- **Workspace** (`WorkspaceDescriptorPayload`) — one cwd + git state. Not "folder/directory" in UI.
- **Workspace kind:** `local_checkout | worktree | directory` (wire also accepts legacy `checkout`).
- **Placement** (`ProjectPlacementPayload`) — a workspace's relationship to its project (projectKey,
  projectName, git checkout snapshot).

### Registries (persisted)
- Project record: `{ projectId, rootPath, kind: git|non_git, displayName, createdAt, updatedAt,
  archivedAt: string|null }`.
- Workspace record: `{ workspaceId, projectId, cwd, kind, displayName, createdAt, updatedAt,
  archivedAt: string|null }`.

### RPCs / operations
| Operation | Surface |
|-----------|---------|
| Open a project | `OpenProjectRequest` / `pi-studio open` / `pi-studio <path>` |
| Archive a workspace | `ArchiveWorkspaceRequest` |
| Clear workspace attention | `WorkspaceClearAttentionMessage` |
| Workspace setup status | `WorkspaceSetupStatusRequest`, `workspace_setup_progress` |
| Directory suggestions | `DirectorySuggestionsRequest` |
| Workspace/git updates | `workspace_update`, `script_status_update` |
| Project icon | `ProjectIconRequest` |

## Behavior & Algorithms

### Project key derivation
```
projectKey:
    if git remote present: derive from normalized remote (e.g. remote:github.com/owner/repo)
    else: derive from normalized mainRepoRoot / rootPath
```
- Active git projects are **unique by normalized `rootPath`**.

### Open project
```
function openProject(path):
    detect git (rootPath, remote, branch)
    resolve/create Project (by projectKey)
    resolve/create the workspace for this cwd (kind = local_checkout | directory | worktree)
    register; broadcast workspace_update
    run pi-studio.json worktree.setup if this is a fresh worktree (see worktrees.md)
```

### Startup reconciliation
```
for duplicate path-keyed projects:
    move their workspaces onto the canonical project
    prefer remote-keyed project ids (remote:github.com/owner/repo) over path-keyed
    archive the emptied duplicate project
```

### Workspace activity bucket
- Workspace status is an aggregate signal. Root agents contribute their normal state bucket to their
  workspace; running subagents contribute `running` to their **root parent's** workspace (not their
  own cwd). See [../architecture/agent-lifecycle.md](../architecture/agent-lifecycle.md).

## Data & Persistence
- `projects/projects.json` and `projects/workspaces.json` (arrays). Soft-delete via `archivedAt`.
  See [../architecture/persistence.md](../architecture/persistence.md).

## Error Handling & Edge Cases
| Condition | Expected behavior |
|-----------|-------------------|
| Duplicate path-keyed projects | Reconcile onto canonical (remote-keyed preferred), archive duplicate |
| Non-git directory opened | Project `kind=non_git`, workspace `kind=directory` |
| Workspace already registered | Reuse existing record |
| Archive workspace with running agents | Workspace soft-deleted; agent archive handled separately |
| Legacy `checkout` workspace kind on wire | Accepted on the wire; not a persisted kind |

## Dependencies
- Internal: workspace registry, reconciliation service, git service, worktree service, pi-studio.json
  config.
- External: git, filesystem.

## Acceptance Criteria
- [ ] Opening a git project derives a remote-based `projectKey` and registers a `local_checkout`.
- [ ] Two registrations of the same normalized `rootPath` resolve to one project.
- [ ] Startup reconciliation migrates workspaces off duplicate projects and archives the empties.
- [ ] Archiving a workspace sets `archivedAt` and removes it from active lists.
- [ ] A running subagent escalates `running` to its root parent's workspace bucket, not its own cwd.

## TODO(verify)
- [ ] Exact `OpenProjectRequest`/`workspace_update` payload fields.
- [ ] Project-icon resolution mechanism.
