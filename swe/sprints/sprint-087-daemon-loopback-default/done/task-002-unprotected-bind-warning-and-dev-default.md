# Task 002 — Warn on an unprotected non-loopback bind; dev daemon binds loopback too

- **Sprint:** sprint-087-daemon-loopback-default
- **Status:** done
- **Type:** feature
- **Area:** packages/server (daemon/bootstrap, daemon/dev-main)
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** task-001

## Goal

An operator who exposes the daemon beyond the machine without a password is told so loudly at
startup. The dev daemon stops serving files to the LAN by default.

## Context / why

**Decision (2026-11-13): warn, do not refuse.** Refusing would break the Docker quickstart, which
binds `0.0.0.0` inside the container on purpose and leaves `PI_STUDIO_PASSWORD` optional
(`docker/docker-compose.yml:11,49`).

The dev daemon (`dev-main.ts:11`) also defaults to `0.0.0.0:6767`. It has no auth at all, and it
still registers `file_read_request`, `file_diff_request` and the file explorer
(`dev-bootstrap.ts:302-351`).

## Scope references

- packages/server/src/daemon/bootstrap.ts:713-720 (host allowlist + `resolvePasswordHash`/
  `createPasswordAuth`), :920-921 (bind + "accepting connections" log)
- packages/server/src/daemon/dev-main.ts; daemon/index.ts (`DEFAULT_DAEMON_LISTEN`)
- packages/server/src/http/host-allowlist.ts (literal IPs always allowed, which is why the warning
  matters)

## What to build

- A pure `isLoopbackHost(host)` helper: `127.0.0.0/8`, `::1`, `localhost` and `*.localhost` count
  as loopback. `0.0.0.0`, `::` and any other address do not.
- In `startDaemon`, after a successful bind: if the bound host is not loopback and no password
  hash is configured, log one `warn` with `{host, port}`, for example:
  `daemon is reachable beyond this machine with no password — set PI_STUDIO_PASSWORD or bind
  127.0.0.1`. No warning for loopback, or when a password is set. The warning is emitted once, not
  per connection.
- `main.ts` echoes the warning in its startup banner line when it applies. Read it from the handle
  (e.g. `handle.exposedWithoutPassword: boolean`) rather than recomputing it.
- `dev-main.ts` defaults to `DEFAULT_DAEMON_LISTEN`. `PI_STUDIO_LISTEN=0.0.0.0:6767` remains the
  opt-in. The dev daemon has no auth, so it logs the same warning whenever it binds a
  non-loopback host.

## Acceptance criteria

- [ ] `isLoopbackHost` table test covers: `127.0.0.1`, `127.1.2.3`, `::1`, `localhost`,
  `foo.localhost` → true; `0.0.0.0`, `::`, `192.168.1.2`, `example.com` → false.
- [ ] Captured logger: binding `0.0.0.0` with no password emits exactly one warn. With a password,
  or bound to `127.0.0.1`, it emits none.
- [ ] `npm run dev:daemon` with a clean env binds `127.0.0.1`.
- [ ] `docker compose up --build` still starts a healthy daemon. It logs the warning when
  `PI_STUDIO_PASSWORD` is unset and stays silent when it is set. Run this if Docker is available;
  otherwise state it was not run.

## Test / verification plan

- `npx vitest run packages/server/src/daemon packages/server/src/http`; `npm run build:server`
