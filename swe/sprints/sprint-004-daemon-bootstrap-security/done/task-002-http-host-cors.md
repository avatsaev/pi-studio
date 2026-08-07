# Task 002 — HTTP server, health route, host allowlist, CORS

- **Sprint:** sprint-004-daemon-bootstrap-security
- **Status:** done
- **Estimated size:** S
- **Depends on:** task-001

## Goal
Create the HTTP server with the health probe and the Host-header allowlist (DNS-rebinding defense)
and CORS handling.

## Scope references
- `clean-room-scope/architecture/auth-security.md` § Host-header allowlist, § CORS, § Behavior
- `clean-room-scope/architecture/daemon-bootstrap.md` § Entry points

## What to build
- HTTP server exposing `GET /api/health` (exempt from auth + host checks).
- Host-header allowlist (Vite-style): default `localhost`, `*.localhost`, any literal IP (v4/v6);
  extend via `hostnames` / `PI_STUDIO_HOSTNAMES` (comma-sep; `.`-prefix = domain+subdomains; literal
  `true` disables). Reject mismatches with `403 Host not allowed`.
- CORS using `daemon.cors.allowedOrigins`; allow preflight (`OPTIONS`).

## Out of scope
- Password auth (task-003). WS upgrade handling (task-004).

## Acceptance criteria
- [ ] `GET /api/health` returns success without host validation or auth.
- [ ] `Host: evil.example.com` is rejected `403` under the default allowlist.
- [ ] `PI_STUDIO_HOSTNAMES=true` disables host validation.
- [ ] `OPTIONS` preflight is allowed and returns CORS headers.

## Test / verification plan
- Tests: `npx vitest run .../host-cors.test.ts` — health exemption, allow/deny hosts, `true` disable,
  preflight.

## Notes
- IPv6-literal allowlist edge cases are TODO(verify).
