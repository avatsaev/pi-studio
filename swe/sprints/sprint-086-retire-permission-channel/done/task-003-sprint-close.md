# Task 003 — Sprint close: docs, specs, gates

- **Sprint:** sprint-086-retire-permission-channel
- **Status:** done
- **Type:** docs
- **Area:** AGENTS.md / README.md (root, server, cli, protocol, web-client); fern; swe
- **Priority:** P2
- **Estimated size:** S
- **Depends on:** task-001, task-002

## Goal

No document describes the permission channel as live.

## What to build

- Update every permission mention found at planning time:
  - root `AGENTS.md` (the "dotted name" example `agent.permission.respond.request` becomes an
    example of a retired family, or another example is used);
  - `AGENTS.md` and `README.md` in `packages/server`, `packages/cli` and `packages/protocol`;
  - `packages/web-client/AGENTS.md`;
  - `fern/pages/cli/overview.mdx` and `fern/pages/cli/feature-groups.mdx` (remove `permit`).
  Re-grep before editing, since the list may have moved.
- `swe/features/tool-permissions.md`: Status set to **retired**, with the evidence and a pointer to
  `extension-ui-rpc.md`. `mcp-server.md` / `cli.md`: drop the permission tools and commands.
- `swe/MAIN-SCOPE.md` § 10: mark the permission open question resolved (retired, sprint-086), and
  set the index row for `tool-permissions.md` to retired.

## Acceptance criteria

- [ ] `grep -rniE "permit|permission" AGENTS.md README.md packages/*/AGENTS.md packages/*/README.md fern/pages`
  shows only retired-family notes or unrelated uses (e.g. file permissions).
- [ ] Gates are green: `npm run build`, `npm run typecheck`, `npm run lint`, `npm run fmt:check`,
  `npm test`.

## Test / verification plan

- The grep above, plus the full gates.
