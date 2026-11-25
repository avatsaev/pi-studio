# Task 002 — Drop the service proxy, CORS and the HTTP password check

- **Sprint:** sprints/sprint-147-drop-dead-subsystems
- **Status:** backlog
- **Type:** refactor
- **Area:** packages/server (proxy, http, auth, config, bootstrap)
- **Priority:** P2
- **Estimated size:** S
- **Depends on:** task-001, task-003

## Goal
The daemon's HTTP server answers `/api/health` and nothing else, with no proxy, CORS or HTTP bearer
code behind it.

## Context / why
Owner decisions 2026-11-24. Nothing registers a proxy route, so `handleRequest` always returns false;
CORS and the HTTP password then protect only a 404. No client fetches `/api/health` from a page
(checked); the CLI and the Docker health check use it from Node. Depends on task-001 (both edit
`bootstrap.ts`) and task-003 (both edit `daemon-config.ts`).

## Scope references
- `docs/daemon-audit-handoff.md` § Decisions → Approved drops: scope (Service proxy)
- `packages/server/src/proxy/` (all), `packages/server/src/http/http-server.ts`,
  `packages/server/src/auth/password-auth.ts` (`authenticateHttp`, `bearerFromAuthHeader`)
- `packages/server/src/config/daemon-config.ts` (`daemon.serviceProxy.*`, `daemon.cors.*`,
  `PI_STUDIO_SERVICE_PROXY_LISTEN`, `_PUBLIC_BASE_URL`, `_ENABLED`)
- `packages/server/src/daemon/bootstrap.ts` (`ServiceProxy`, `onRequest`, `allowedOrigins`, `authenticate`)

## What to build
Delete them and their tests. `createHttpServer` keeps the Host check and `/api/health` (exempt) and
answers 404 to everything else. The WebSocket upgrade path (`authenticateUpgrade`, Host check, the
Origin rule of sprint-146/task-001) is untouched. Docs: root `AGENTS.md` env-var table rows,
`packages/server/AGENTS.md`/`README.md`, fern daemon-config page.

## Acceptance criteria
- [ ] `GET /api/health` → 200 `{status, version}`; any other path → 404; no `Access-Control-*` header.
- [ ] A WebSocket upgrade still requires the password when one is set.

## Test / verification plan
- `npx vitest run packages/server/src/http packages/server/src/auth packages/server/src/daemon`
- `npm run build:server`
