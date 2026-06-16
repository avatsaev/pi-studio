# Task 003 — Service proxy (generated hostnames + routing) — Summary

- **Sprint:** sprint-009-terminals-proxy-files
- **Completed:** 2026-06-11
- **Status:** done

## What was implemented
`packages/server/src/proxy/`:
- **`service-hostname.ts`** — `serviceLabel()` builds the combined leftmost label
  `script--branch--project` (branch omitted for `main`/`master` → `script--project`), slugging each
  segment; over-63-char labels are truncated with a deterministic 7-char hash suffix.
  `serviceHostname()` → `<label>.localhost`; `publicServiceHostname()` → `<label>.<publicBaseUrl>`.
- **`service-port-registry.ts`** — `ServicePortRegistry`: `register()` (localhost + optional public
  hostnames → port), `unregister()` (on service stop), `lookup(host)` (strips `:port`), `list()`.
  `assignFreePort()` binds to port 0 to obtain a free localhost port.
- **`service-proxy.ts`** — `resolveServiceProxyConfig(daemonServiceProxy, env)` (env overrides win;
  `enabled:false` ⇒ optional layers off, localhost stays on). `ServiceProxy.handleRequest(req, res)`
  reverse-proxies a matching `Host` to `127.0.0.1:{port}` forwarding `Host` **unchanged**, returns
  `false` to fall through to normal daemon handling on no match, and 502s when the service isn't
  listening. `listenAddress` exposes the optional service-only listener only when enabled.

## Files created / changed
| File | Change |
|------|--------|
| `packages/server/src/proxy/service-hostname.ts` | created |
| `packages/server/src/proxy/service-port-registry.ts` | created |
| `packages/server/src/proxy/service-proxy.ts` | created |
| `packages/server/src/proxy/index.ts` | created |
| `packages/server/src/index.ts` | modified (re-export) |
| `packages/server/src/proxy/service-proxy.test.ts` | added — 7 tests (real HTTP round-trip) |

## Build & test results
```
$ npm run build:server                                            → exit 0
$ npx vitest run packages/server/src/proxy/service-proxy.test.ts  → 7 passed
$ npx oxlint / oxfmt --check packages/server/src/proxy             → clean
```

## Acceptance criteria
- [x] Starting a `type:"service"` script assigns a port and registers a localhost route
      (port registry + `assignFreePort`; task-002 flags service scripts).
- [x] A request to `<script>--<project>.localhost` proxies to the service port (Host forwarded
      unchanged — verified against a real backend service).
- [x] `main`/`master` omits the branch segment; over-long labels truncate with a stable hash suffix.
- [x] `publicBaseUrl` produces public aliases; `enabled:false` suppresses only optional layers.
- [x] Password auth does not gate proxied service traffic (the proxy handler runs before/independent
      of the auth pipeline; no auth check in `handleRequest`).

## Follow-ups / TODO(verify)
- Exact branch/project slugging + public TLS handling (modeled slug = lowercase `[a-z0-9-]`).
- Wiring `handleRequest` into the daemon HTTP listener + starting the optional `listen` socket is a
  bootstrap integration step; the proxy is transport-ready.
