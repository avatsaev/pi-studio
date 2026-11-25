# Task 001 — The daemon refuses every WebSocket upgrade that carries an `Origin` — Summary

- **Sprint:** sprints/sprint-146-close-the-door
- **Completed:** 2026-11-24
- **Status:** done

## What was implemented
`ws-server.ts` answers `403 Origin not allowed` to any upgrade whose `Origin` header is not in the allowlist (default: empty), after the Host check and before the password check, and logs a warning. No `Origin` passes. Developer switch: `daemon.devAllowedOrigins` / `PI_STUDIO_DEV_ALLOWED_ORIGINS` (comma-separated, env wins). The dev daemon fixes it to the two Vite origins (`http://localhost:5173`, `http://127.0.0.1:5173`). `/api/health` is untouched.

## Files created / changed
| File | Change |
|------|--------|
| `packages/server/src/ws/ws-server.ts`, `ws-server.test.ts` | Origin rule; tests (403, 101 without origin, 101 allowlisted, host and password still enforced) |
| `packages/server/src/config/daemon-config.ts`, `daemon-config.test.ts` | `daemon.devAllowedOrigins`, env overlay |
| `packages/server/src/daemon/bootstrap.ts`, `dev-bootstrap.ts` | pass the allowlist; one warning when non-empty; dev default |
| root `AGENTS.md`, `packages/server/AGENTS.md`, `README.md`, `fern/pages/configuration/daemon.mdx` | rule and switch documented |

## How it satisfies the scope
Handoff finding S1. Verified read-only that `packages/client/src/transport.ts`, `packages/cli/src/connection.ts` and `desktop/crates/net/src/dial.rs` send no `Origin`.

## Build & test results
```
$ npx vitest run packages/server/src/ws/ws-server.test.ts packages/server/src/config   -> 52 passed
$ npm run build:server                                                                 -> success
$ npx oxlint / npx oxfmt on changed files                                              -> clean
$ Wave gate (full tree, once, after tasks 001-005): `npm run build` exit 0; `npm run typecheck` exit 0; `npm run lint` exit 0 (existing warnings only); `npm test`: 329 of 330 files pass, 4727 of 4728 tests pass. The one failure, `packages/server/src/daemon/bootstrap.test.ts` > "extension packs RPC ... full round trip", fails identically on a pristine checkout of HEAD `a6efaa9a` (checked in a temporary worktree), so it is not caused by this sprint. `npm run fmt:check` reports 25 files; the 8 docs/compose files this sprint touched were already unformatted at HEAD.
```

## Acceptance criteria
- [x] Evil origin gets 403 and creates no session (test)
- [x] No `Origin` gets 101 (test)
- [x] Allowlisted origin gets 101; other port or scheme 403 (test)
- [x] Env wins over `config.json` (unit test on `overlayEnv`, not through a running daemon)
- [x] Host and password checks still apply (auth tested with a stub, not a real bcrypt password)
- [x] Docs describe the rule and the switch

## Follow-ups / TODO(verify)
- The live `curl` probe against a real daemon is done in task-006.
