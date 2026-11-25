# Task 002 — Drop the service proxy, CORS and the HTTP password check — Summary

- **Sprint:** sprints/sprint-147-drop-dead-subsystems
- **Completed:** 2026-11-25
- **Status:** done

## What was implemented
`http/http-server.ts` answers `/api/health` (200 `{status, version}`, exempt from the Host check), applies the Host check (403) and answers 404 to everything else; no CORS, `authenticate`, `onRequest` or `allowedOrigins` (an `OPTIONS` request now gets 404). Deleted `packages/server/src/proxy/`; removed `authenticateHttp`/`bearerFromAuthHeader`, the `daemon.cors`/`daemon.serviceProxy` config and the three `PI_STUDIO_SERVICE_PROXY_*` overlays, `isServiceScript`, and the bootstrap wiring. Docs: root and server `AGENTS.md`, server `README.md`; `swe/features/service-proxy.md` marked retired.

## Files created / changed
Deleted: `packages/server/src/proxy/*` (5 files). Changed: `http/{http-server,index}.ts` (+test), `auth/password-auth.ts` (+test), `config/{daemon-config,project-config}.ts` (+tests), `daemon/bootstrap.ts`, `server/src/index.ts`, comments in `terminal/terminal-rpc.ts`, `terminal-manager.ts`; docs as above.

## Build & test results
```
$ npx vitest run packages/server/src/http packages/server/src/auth packages/server/src/daemon packages/server/src/config   -> 21 files, 286 passed
$ Wave gate (full tree, once, after tasks 002 and 004): `npm run build` exit 0; `npm run typecheck` exit 0; `npm run lint` exit 0 (existing warnings only); `npm test` 325 files, 4671 tests, all passed; `oxfmt --check` on all changed source files clean.
```

## Acceptance criteria
- [x] `GET /api/health` -> 200 `{status, version}`; any other path -> 404; no `Access-Control-*` header (new tests)
- [x] A WebSocket upgrade still requires the password when one is set (existing upgrade tests)

## Follow-ups / TODO(verify)
- The Docker health check, `scripts/binary-smoke.mjs`, `binary-update-check` and `binary-container-check.sh` use `/api/health` without CORS or auth; not run here (the sprint's live check covers the daemon).
- The terminal `service` flag and the `type:"service"` script type remain (protocol and terminal area, not in this task).
- `packages/server/README.md` "Security model" still mentions a `password` query parameter and a bearer subprotocol; that text predates this change.
