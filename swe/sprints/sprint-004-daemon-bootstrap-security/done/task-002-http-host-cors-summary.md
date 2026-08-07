# Task 002 — HTTP server, health route, host allowlist, CORS — Summary

- **Sprint:** sprint-004-daemon-bootstrap-security
- **Completed:** 2026-06-11
- **Status:** done

## What was implemented
- `packages/server/src/http/host-allowlist.ts` — `parseHostHeader` (strips port + IPv6 brackets) and
  `createHostChecker(hostnames)`: always allows `localhost`, `*.localhost`, and any literal IP
  (v4/v6 via `node:net.isIP`); extends via entries (a `.`-prefixed entry matches a domain + its
  subdomains); `true` disables validation.
- `packages/server/src/http/http-server.ts` — `createHttpServer(deps)` / `createRequestListener`
  implementing the pipeline: `OPTIONS` preflight and `GET /api/health` are exempt from host + auth;
  then Host allowlist (`403 Host not allowed`), CORS headers from `allowedOrigins`, optional bearer
  `authenticate` hook (wired in task-003), then `onRequest` delegation else 404. Health returns
  `{ status: "ok" }`.

## Files created / changed
| File | Change |
|------|--------|
| `packages/server/src/http/host-allowlist.ts` | created |
| `packages/server/src/http/http-server.ts` | created |
| `packages/server/src/http/index.ts` | created (barrel) |
| `packages/server/src/index.ts` | modified — re-exports http |
| `packages/server/src/http/http-server.test.ts` | added — 8 tests |

## How it satisfies the scope
- **auth-security.md § Host-header allowlist / § CORS / § Behavior:** Vite-style allowlist defaults,
  `.`-prefix subdomain matching, `true` disable, 403 rejection, preflight + health exemption order.
- **daemon-bootstrap.md § Entry points:** `GET /api/health` liveness probe exempt from auth + host.

## Build & test results
```
$ npm run build:server          → exit 0 (no type errors)
$ npx vitest run packages/server/src/http/http-server.test.ts
 ✓ http-server.test.ts (8 tests)
 Test Files  1 passed (1)      Tests  8 passed (8)
$ npx oxlint packages/server   → clean
```

## Acceptance criteria
- [x] `GET /api/health` returns success without host validation or auth (verified with a
      disallowed Host header still returning 200).
- [x] `Host: evil.example.com` is rejected `403` under the default allowlist.
- [x] `hostnames:true` (`PI_STUDIO_HOSTNAMES=true`) disables host validation.
- [x] `OPTIONS` preflight is allowed and returns CORS headers; disallowed origins are not reflected.

## Follow-ups / TODO(verify)
- Default `allowedOrigins` and exact desktop/web origin permitting are TODO(verify) (defaulted to
  `[]`; `"*"` wildcard supported).
- IPv6-literal allowlist edge cases beyond `[::1]` are TODO(verify).
- The `authenticate` hook is present but unused until task-003.
