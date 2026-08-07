# Task 004 — Feature command groups — Summary

- **Sprint:** sprint-011-cli
- **Completed:** 2026-06-14
- **Status:** done

## What was implemented
The remaining CLI command groups, each mirroring its daemon RPC, plus top-level project open.

- **`feature-commands.ts`**:
  - `FEATURE_RPC` — the command→RPC mapping for every group.
  - `featureRpc(ctx, opts, type, params, render)` — generic connect → request → render → exit-code.
  - `runOpenProject(ctx, opts, path)` — shared by `open <path>` and the bare `pi-studio <path>` form.
  - `registerFeatureCommands` wires:
    - **chat**: `create`, `ls`, `inspect`, `post`, `read`, `wait`, `delete`.
    - **terminal**: `ls`, `create`, `capture`, `send-keys`, `kill` (registered daemon handlers).
    - **loop**: `run`, `ls`, `inspect`, `logs`, `stop`.
    - **schedule**: `create`, `ls`, `inspect`, `update`, `pause`, `resume`, `run-once`, `logs`, `delete`.
    - **permit**: `ls`, `allow`, `deny` (→ `respond_to_permission` with `response`).
    - **provider**: `ls`, `models` (→ MCP tools `list_providers`/`list_models`).
    - **worktree**: `create`, `ls`, `archive` (registered `*_pistudio_worktree_*` handlers).
    - **open `<path>`** (→ registered `open_project_request`).
- **program.ts**: registers the feature group; the root now accepts an optional `[path]` argument so
  bare `pi-studio <path>` opens a project, while bare `pi-studio` runs onboard.
- Output: list commands render tables (`tableOf`), detail commands render objects (`renderObject`),
  mutations render a short ack; `--json` always prints the raw payload.

## Files created / changed
| File | Change |
|------|--------|
| `packages/cli/src/feature-commands.ts` | created |
| `packages/cli/src/feature-commands.test.ts` | added (8 tests) |
| `packages/cli/src/program.ts` | register feature group + bare `<path>` open routing |
| `packages/cli/src/program.test.ts` | added feature/open routing tests; neutralized onboard side-effects |
| `packages/cli/src/index.ts` | re-export feature-commands |

## How it satisfies the scope
Maps to `features/cli.md` § Command tree and the per-feature scopes (chat-rooms, terminals, loops,
schedules-heartbeats, tool-permissions, agent-providers, worktrees). Each command issues the same WS
RPC as its app/MCP equivalent; terminal/worktree/provider/permission names match registered daemon
handlers + MCP tool names, and chat/loop/schedule follow the `_request` convention pending their
integration-sprint handlers.

## Build & test results
```
$ npx tsc -b packages/cli                                   → exit 0
$ npm run build                                             → exit 0 (all packages)
$ npx vitest run packages/cli/src                           → 58 passed (5 files)
$ npx vitest run            (full suite)                    → 415 passed (60 files)
$ npx oxlint packages/cli/src                               → clean
$ npx oxfmt --check packages/cli/src                        → clean
```

## Acceptance criteria
- [x] Each command maps to the same RPC as its app/MCP equivalent and renders results (verified: one
      round-trip per group in `feature-commands.test.ts` asserts the wire `type` + params + render).
- [x] `permit ls/allow/deny` resolves pending permissions (verified: `allow`/`deny` →
      `respond_to_permission` with `response`; `ls` → `list_permissions_request`).
- [x] `pi-studio <path>` opens a project (verified: `runOpenProject` → `open_project_request`; program
      test routes the bare `<path>` form; `open <path>` subcommand also wired).
- [x] `worktree create/ls/archive` manage Pi-Studio worktrees (verified: `worktree create` →
      `create_pistudio_worktree_request`; ls/archive wired to the registered handlers).

## Follow-ups / TODO(verify)
- Chat / loop / schedule wire names (`chat_*_request`, `loop_*_request`, `schedule_*_request`) and
  `list_permissions_request` follow the naming convention; their daemon handlers land in an
  integration sprint. Flagged in `FEATURE_RPC`. Tests use a scripted fake daemon.
- Exact per-command table columns / flags remain TODO(verify) per cli.md.
- `terminal send-keys`/`capture` use session RPCs here; production terminal I/O also rides binary
  frames (terminals.md) — confirm the CLI's preferred path. TODO(verify).
