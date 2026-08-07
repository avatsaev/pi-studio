# Auth & Security Boundaries — Clean Room Scope

> Part of: [MAIN-SCOPE.md](../MAIN-SCOPE.md)
> Related scopes: [relay-e2ee.md](relay-e2ee.md), [websocket-protocol.md](websocket-protocol.md),
> [config.md](config.md)

## Purpose

Defines the daemon's trust boundaries: when network reachability alone grants control, the optional
shared-secret password, Host-header validation (DNS-rebinding defense), and CORS. The model mirrors
Docker's daemon: the boundary is access to the socket/listening address.

## Public Contract

### Password auth (optional)
- Configured via `auth.password` in `config.json` or `PI_STUDIO_PASSWORD` env; **stored bcrypt-hashed**.
- When configured:
  - Every HTTP request must carry `Authorization: Bearer <password>`.
  - Every WebSocket upgrade must include subprotocol `Sec-WebSocket-Protocol: pi-studio.bearer.<password>`
    (browsers can't set custom WS headers, so the token rides in the subprotocol).
  - **Exempt:** `GET /api/health` and CORS preflight (`OPTIONS`).
- Intended for direct-TCP exposure (e.g. `tcp://host:port?ssl=true&password=...`). It is **not** a
  substitute for the relay's E2E encryption on untrusted networks.

### Host-header allowlist (DNS rebinding defense)
- Every HTTP request and WS upgrade validates the `Host` header against an allowlist (Vite-style).
- Default allowed: `localhost`, `*.localhost`, and any literal IP (IPv4/IPv6).
- Extend via `hostnames` in `config.json` or `PI_STUDIO_HOSTNAMES` (comma-separated). Entries starting
  with `.` match a domain and its subdomains. The literal value `true` disables the allowlist.
- Rejection: `403 Host not allowed`.

### CORS
- `daemon.cors.allowedOrigins` controls which browser origins may call the daemon. Defense-in-depth
  only; not a complete boundary.

## Behavior & Algorithms

```
on http request / ws upgrade:
    if path == /api/health or method == OPTIONS: skip auth + host checks
    if host header not in allowlist: respond 403 "Host not allowed"
    if password configured:
        token = bearerFromHeader(req) or bearerSubprotocol(wsUpgrade)
        if not bcryptCompare(token, storedHash): reject 401
    proceed
```

### Trust model
- **Local default:** daemon binds `127.0.0.1`; with no password, anything that can reach the socket
  controls the daemon (trusted by network reachability).
- **Connected clients are trusted operators** of the daemon user. File previews follow that
  authority: a preview may read any regular file the daemon process can read; path normalization
  and symlink checks stay in the daemon file service. Workspace-relative paths are a UI convenience,
  **not** a security boundary.
- **Beyond loopback** (bind `0.0.0.0`, tunnels, Docker publish) is the operator's responsibility;
  setting a password is strongly recommended; the relay is the supported remote path.
- **Agent auth:** Pi-Studio never stores or transmits provider API keys; each agent CLI handles its own
  credentials and runs in the user's context.

## Error Handling & Edge Cases
| Condition | Expected behavior | Surface |
|-----------|-------------------|---------|
| Unknown Host header | Reject | `403 Host not allowed` |
| Missing/invalid password when required | Reject | `401` (HTTP) / upgrade refused (WS) |
| Health check / preflight | Always allowed | `200` / CORS headers |
| Browser cannot set WS headers | Token via `pi-studio.bearer.<password>` subprotocol | — |

## Dependencies
- Internal: websocket-server, http server, config store, file service.
- External: bcrypt.

## Acceptance Criteria
- [ ] With a password set, an HTTP request without a valid bearer token is rejected, but
      `GET /api/health` succeeds.
- [ ] A WS upgrade authenticates via the `pi-studio.bearer.<password>` subprotocol.
- [ ] A request with `Host: evil.example.com` is rejected `403` under the default allowlist.
- [ ] `PI_STUDIO_HOSTNAMES=true` disables host validation.
- [ ] No provider API key is ever persisted or transmitted by the daemon.

## TODO(verify)
- [ ] Exact default `allowedOrigins` and how desktop/web origins are permitted.
- [ ] Whether IPv6 literal handling has edge cases in the allowlist matcher.
