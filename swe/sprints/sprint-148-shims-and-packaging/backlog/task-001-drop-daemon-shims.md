# Task 001 — Drop the daemon's compatibility shims

- **Sprint:** sprints/sprint-148-shims-and-packaging
- **Status:** backlog
- **Type:** refactor
- **Area:** packages/server (config, ws, projects, persistence, terminal, bootstraps)
- **Priority:** P2
- **Estimated size:** S
- **Depends on:** sprint-147/task-001, sprint-147/task-006

## Goal
The daemon has no code for old config shapes, old message names, or switches that are always on.

## Context / why
Owner decision 2026-11-24 (the six approved drops; `.passthrough()` and `version: 1` are kept).
Depends on sprint-147/task-001 (it removes five of the six aliases) and sprint-147/task-006 (last
edit of `daemon-config.ts` there).

## Scope references
- `docs/daemon-audit-handoff.md` § Decisions → Compatibility shims
- `packages/server/src/config/daemon-config.ts` (`migrateConfig`, `migrateProviderSettings`, the
  `allowedHosts` rename)
- `packages/server/src/ws/router.ts` (`registerAlias`, the alias map),
  `packages/server/src/agent/session-operations.ts` (`cancel_agent`)
- `packages/server/src/projects/workspace-registry.ts` (`normalizeWorkspaceKind`'s `checkout`)
- `packages/server/src/persistence/atomic-store.ts` (`loadStore`'s `normalize` option)
- `checkoutRefreshEnabled` (`projects/git-checkout-rpc.ts`), `setAutoMergeEnabled`
  (`projects/github-service.ts`), `restoreModesEnabled` (`terminal/terminal-rpc.ts`), and where
  `bootstrap.ts`/`dev-bootstrap.ts` pass them

## What to build
Delete each shim; the always-on switches become the only behaviour. Tests for the removed shapes go;
nothing is re-pinned. Docs: `packages/server/AGENTS.md` (the router section's alias wording), root
`AGENTS.md` § Protocol overview (the paragraph saying flat names are registered as aliases of dotted
ones).

## Out of scope
`legacyRespondToPermissionSchema` (task-002); `.passthrough()` and `version: 1` (kept by decision).

## Acceptance criteria
- [ ] `HandlerRegistry` has no alias API; `cancel_agent` answers `unknown_message_type`.
- [ ] A `config.json` with `allowedHosts` no longer sets `hostnames`.

## Test / verification plan
- `npx vitest run packages/server/src`
- `npm run build:server`
