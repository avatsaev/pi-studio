# Task 002 — Agent commands (+ top-level)

- **Sprint:** sprint-011-cli
- **Status:** done
- **Estimated size:** M
- **Depends on:** task-001

## Goal
Implement the `agent` command group and its top-level aliases over the same RPCs as app/MCP.

## Scope references
- `clean-room-scope/features/cli.md` § Command tree (agent), § Example invocations
- `clean-room-scope/features/agent-sessions.md` § Other operations

## What to build
- `agent` group (also top-level): `ls`, `run`, `import`, `attach`, `logs`, `stop`, `delete`, `send`,
  `inspect`, `wait`, `archive`, `reload`, `update`, `mode`.
- `run --provider pi/<model> [--worktree <name>] "<prompt>"` creates+runs an agent and prints its id;
  `--worktree` launches inside a Pi-Studio worktree.
- `attach <id>` subscribes to the timeline and streams events; `logs` fetches history.
- `ls` lists running agents (`-a` all, `-g` global).

## Out of scope
- daemon group (task-003). Other feature groups (task-004).

## Acceptance criteria
- [ ] `pi-studio run --provider <p>/<model> "<prompt>"` creates+runs an agent and prints its id.
- [ ] `pi-studio ls` lists running agents; `-a -g` lists all/global.
- [ ] `pi-studio attach <id>` streams the live timeline.
- [ ] `send`/`stop`/`update`/`mode` map to the same RPCs as app/MCP equivalents.

## Test / verification plan
- Tests: `npx vitest run packages/cli/.../agent-cmds.test.ts` against a test daemon (mock provider) —
  run+print id, ls, attach stream, send.

## Notes
- `--provider pi/<model>` combines provider id + model.
