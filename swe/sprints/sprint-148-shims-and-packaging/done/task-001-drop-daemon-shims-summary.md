# Task 001 — Drop the daemon's compatibility shims — Summary

- **Sprint:** sprints/sprint-148-shims-and-packaging
- **Completed:** 2026-11-25
- **Status:** done

## What was implemented
Removed `registerAlias` and the alias map from `HandlerRegistry` (`cancel_agent` now answers `unknown_message_type`); `migrateConfig` and `migrateProviderSettings` (the `allowedHosts` rename and the old provider `command:{mode,…}` form); the `checkout` to `local_checkout` mapping in `normalizeWorkspaceKind` (unknown kinds still fall back to `directory`); the `normalize` option of `loadStore`; the always-on switches `checkoutRefreshEnabled`, `setAutoMergeEnabled`, `restoreModesEnabled` and their bootstrap wiring (`checkout_refresh_request` and `checkout.github.set_auto_merge.request` are always registered). Orchestrator follow-ups: removed the now-unused `webDist` from `runtime/self.ts` and its tests (task-003 left it without callers); fixed docs (server `AGENTS.md`, root `AGENTS.md` alias clause).

## Files changed
`packages/server/src/{config/daemon-config,ws/router,agent/session-operations,projects/workspace-registry,persistence/atomic-store,projects/git-checkout-rpc,projects/github-service,terminal/terminal-rpc,daemon/bootstrap,daemon/dev-bootstrap,runtime/self}.ts` and their tests; `packages/server/AGENTS.md`; root `AGENTS.md`.

## Build & test results
```
$ npx vitest run packages/server/src   -> 111 files, 1573 passed
$ npm run build:server                 -> success
$ Wave gate (full tree, once, after tasks 001-003): `npm run build` exit 0; `npm run typecheck` exit 0; `npm run lint` exit 0 (existing warnings only); `npm test` 323 files, 4648 tests all passed; `oxfmt --check` on changed files clean; `node --test scripts/release/*-test.mjs scripts/build-binary.test.mjs scripts/binary-smoke.test.mjs` 22 passed.
```

## Acceptance criteria
- [x] `HandlerRegistry` has no alias API; `cancel_agent` answers `unknown_message_type` (no caller anywhere: client, cli, desktop; not pinned by a test, by decision "nothing is re-pinned")
- [x] A `config.json` with `allowedHosts` no longer sets `hostnames` (the migration is gone; not pinned by a test)

## Follow-ups / TODO(verify)
- None.
