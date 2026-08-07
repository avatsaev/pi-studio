# Worktrees — Clean Room Scope

> Part of: [MAIN-SCOPE.md](../MAIN-SCOPE.md)
> Related scopes: [projects-workspaces.md](projects-workspaces.md), [git-checkout.md](git-checkout.md),
> [../architecture/agent-lifecycle.md](../architecture/agent-lifecycle.md),
> [../architecture/config.md](../architecture/config.md), [cli.md](cli.md)

## Purpose

A **worktree** is a Pi-Studio-managed git worktree (an isolated copy of a repo, under
`~/.pi-studio/worktrees/{name}` by default) where agents work without affecting the main checkout. It is
also a `workspaceKind` value. Worktrees support per-project `setup`/`teardown` lifecycle commands and
participate in agent auto-archive.

## Public Contract

### Operations
| Operation | Surface |
|-----------|---------|
| Create worktree | `CreatePi-StudioWorktreeRequest`, `create_worktree` (MCP), `pi-studio worktree create` |
| List worktrees | `Pi-StudioWorktreeListRequest`, `list_worktrees` (MCP), `pi-studio worktree ls` |
| Archive worktree | `Pi-StudioWorktreeArchiveRequest`, `archive_worktree` (MCP), `pi-studio worktree archive` |

### Lifecycle config (`pi-studio.json`)
```
{ "worktree": { "setup": string | string[], "teardown": string | string[] } }
```
- Commands run with environment context including `PI_STUDIO_WORKTREE_PATH`, `PI_STUDIO_SOURCE_CHECKOUT_PATH`
  (and service-related vars for service scripts).
- `setup` runs after worktree creation; `teardown` runs on archive.

### Branch name generation
- A worktree/branch name may be generated (see
  [../architecture/structured-generation.md](../architecture/structured-generation.md)); slugged via
  branch-slug rules. A deterministic hash suffix avoids collisions / length limits.

## Behavior & Algorithms

```
function createWorktree(intent):
    resolve target branch (existing or new; generate name if requested)
    git worktree add {root}/{name} <branch>
    register workspace (kind="worktree") under the project
    run pi-studio.json worktree.setup commands (stream workspace_setup_progress)
    return worktree descriptor

function archiveWorktree(name):
    run pi-studio.json worktree.teardown commands
    archive all agent records whose cwd is inside the worktree
    git worktree remove (and prune)
    mark workspace archivedAt
```

- **Creation intent** is resolved from request inputs (branch vs. new branch, base ref, name) — see
  `resolve-worktree-creation-intent`.
- **Auto-archive coupling:** if an agent was created with `autoArchive` and a `worktree` target, the
  agent's terminal turn archives the agent *and* its worktree (removing agent records inside it). See
  [../architecture/agent-lifecycle.md](../architecture/agent-lifecycle.md).
- Worktree root defaults to `$PI_STUDIO_HOME/worktrees`, overridable via `worktrees.root` in config.

## Data & Persistence
- Worktrees are workspaces in `projects/workspaces.json` with `kind="worktree"`. Agent records live
  in `agents/{sanitized-cwd}/...` keyed by the worktree cwd.

## Error Handling & Edge Cases
| Condition | Expected behavior | Surface |
|-----------|-------------------|---------|
| Branch name collision | Deterministic hash suffix disambiguates | — |
| `setup` command fails | Surface progress/error; worktree may remain for inspection | `workspace_setup_progress` |
| Archive with running agents inside | Agents archived (cascade), process killed, then worktree removed | global |
| Dirty worktree on archive | Teardown then removal per git semantics | worktree-errors |
| Name exceeds limits | Truncate + hash suffix | — |

## Dependencies
- Internal: worktree-core/session/bootstrap, pi-studio-worktree-service, archive service, git service,
  structured generation (branch names), agent lifecycle.
- External: git, filesystem.

## Acceptance Criteria
- [ ] Creating a worktree adds a git worktree, registers a `worktree` workspace, and runs `setup`.
- [ ] Archiving a worktree runs `teardown`, archives contained agents, and removes the git worktree.
- [ ] `autoArchive` + `worktree` archives both agent and worktree after the first terminal turn.
- [ ] Branch/worktree names that collide or exceed limits get a deterministic hash suffix.
- [ ] Worktree root honors `worktrees.root` when configured.

## TODO(verify)
- [ ] Full set of env vars exposed to setup/teardown commands.
- [ ] `CreatePi-StudioWorktreeRequest` field shape and intent resolution rules.
