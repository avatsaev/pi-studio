# Task 003 — Service proxy (generated hostnames + routing)

- **Sprint:** sprint-009-terminals-proxy-files
- **Status:** done
- **Estimated size:** M
- **Depends on:** task-002; task-003 (sprint-003, pi-studio.json scripts)

## Goal
Implement the HTTP service proxy that gives workspace `type:"service"` scripts stable, generated
hostnames.

## Scope references
- `clean-room-scope/features/service-proxy.md` § Generated hostname, § Config, § Behavior
- `clean-room-scope/architecture/config.md` (`daemon.serviceProxy`), `clean-room-scope/architecture/auth-security.md`

## What to build
- On `type:"service"` script start: assign a free local port; register a route
  `hostname(script,branch,project) → port`; deregister + release on stop.
- Hostname: `<script>--<branch>--<project>.localhost` (omit branch for main/master:
  `<script>--<project>.localhost`). One combined leftmost label (single-level wildcard friendly).
  Over-63-char labels → truncate + deterministic hash suffix.
- Request handling (daemon listener + optional service-only `listen`): look up route by `Host`
  header; if matched, reverse-proxy to `127.0.0.1:{port}` forwarding `Host` unchanged; else normal
  daemon handling.
- Config `daemon.serviceProxy.{listen?, publicBaseUrl?, enabled?}` (+ env overrides); `enabled:false`
  suppresses only the optional public/listen layers (localhost proxy stays on).
- Service traffic is NOT gated by daemon password auth.

## Out of scope
- External reverse proxy / wildcard DNS setup (operator concern). File transfer (task-004/005).

## Acceptance criteria
- [ ] Starting a `type:"service"` script assigns a port and registers a localhost route.
- [ ] A request to `<script>--<project>.localhost` proxies to the service port (Host forwarded unchanged).
- [ ] `main`/`master` omits the branch segment; over-long labels truncate with a stable hash suffix.
- [ ] `publicBaseUrl` produces public aliases; `enabled:false` suppresses only optional layers.
- [ ] Password auth does not gate proxied service traffic.

## Test / verification plan
- Tests: `npx vitest run .../service-proxy.test.ts` — hostname generation, route match/proxy,
  branch omission, label truncation, enabled:false behavior.

## Notes
- Exact branch/project slugging + public TLS handling are TODO(verify).
