# Task 001 — The daemon refuses every WebSocket upgrade that carries an `Origin`

- **Sprint:** sprints/sprint-146-close-the-door
- **Status:** done
- **Type:** feature
- **Area:** packages/server (ws, config, bootstraps)
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** none

## Goal
A web page can no longer reach the daemon's direct port. Requests from the CLI and the desktop app,
which send no `Origin`, are unaffected. A developer switch lets named origins through for local web
development.

## Context / why
Finding S1 (checked live on 2026-11-24): an upgrade with `Origin: https://evil.example` to a default
daemon answered `101`, so any website open on the machine could open a terminal. With the web client
now relay-only ("Lite", owner decision 2026-11-24), no legitimate browser uses the direct port, so the
rule is "refuse any `Origin`", not an allowlist of web origins. The relay path is unaffected: the
daemon dials the relay, so there is no upgrade on the daemon side.

## Scope references
- `docs/daemon-audit-handoff.md` § Decisions → Web client as "Lite", § S1, § Milestones (M1)
- `packages/server/src/ws/ws-server.ts` (upgrade handler)
- `packages/server/src/config/daemon-config.ts` (schema + `overlayEnv`)
- `packages/server/src/daemon/bootstrap.ts`, `packages/server/src/daemon/dev-bootstrap.ts`
- `desktop/crates/net/src/dial.rs` (confirm: the Rust dial sends no `Origin`)

## What to build
- Upgrade handler: when the request has an `Origin` header that is not on the developer allowlist,
  answer `403 Origin not allowed`, destroy the socket, log `warn` with the origin and remote address.
  Order: Host check, then Origin, then password.
- Developer switch: `daemon.devAllowedOrigins: string[]` in `config.json`, overridden by
  `PI_STUDIO_DEV_ALLOWED_ORIGINS` (comma-separated). Exact match on scheme, host and port. Default
  empty. When non-empty the daemon logs one `warn` at start naming the allowed origins.
- Dev daemon (`npm run dev:daemon`): the same check, with the allowlist defaulting to the Vite dev
  origins (`http://localhost:5173`, `http://127.0.0.1:5173`) so web development keeps working.
- `/api/health` is untouched.

## Out of scope
The web client's own changes (task-003); the non-loopback password rule (task-002); dropping CORS
(sprint-147/task-002).

## Acceptance criteria
- [ ] Upgrade with `Origin: https://evil.example` → 403, no session created.
- [ ] Upgrade with no `Origin` → 101 (CLI, desktop).
- [ ] Upgrade with an allowlisted origin → 101; the env value wins over `config.json`.
- [ ] The Host check and the password check still apply to every upgrade.
- [ ] Root `AGENTS.md` env-var table and `packages/server/AGENTS.md` describe the rule and the switch.

## Test / verification plan
- `npx vitest run packages/server/src/ws packages/server/src/config`
- `npm run build:server`
- Manual: the `curl` probe in `docs/daemon-audit-handoff.md` § 14 answers 403.

## Notes
The `ws` package's Node client sends no `Origin` unless asked; check `packages/client/src/transport.ts`
and `packages/cli/src/connection.ts` do not set one.
