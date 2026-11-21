# Task 001 — `net` crate: dialling (TCP, TLS, the WebSocket upgrade, error classes)

- **Sprint:** sprint-115-desktop-bridge-core
- **Status:** backlog
- **Type:** feature
- **Area:** desktop/crates/net
- **Priority:** P1
- **Estimated size:** M
- **Depends on:** sprint-112/task-003, sprint-112/task-007 (the gate passed)

## Goal
The `net` crate can open a WebSocket to a daemon with an optional bearer password, within 15 s, and says precisely why when it cannot.

## Context / why
The browser's socket reports every failure as the same error. Rust can tell a wrong password from an expired certificate from a daemon that is down, and the connection bar shows the difference.

## Scope references
- `swe/features/desktop-transport-bridge.md` § 2 (`transport_open`), § 6 (socket options), § 8 (TLS trust), § Error handling (the error table), § TODO(verify) (TLS licences)
- `packages/server/src/auth/password-auth.ts` (`pi-studio.bearer.<password>`), `packages/server/src/ws/ws-server.ts` (401, 403, the echoed subprotocol)
- `desktop/crates/net/` (sprint-112/task-003)
- `desktop/AGENTS.md` rules 2 and 9
- `desktop/docs/architecture.md` § What stays out of the core

## What to build
- Dependencies, each checked for a permissive licence first: an async runtime and a WebSocket client (`tokio`, `tokio-tungstenite` are the candidates), TLS that trusts the operating system's certificate store (`rustls` with `ring` and the platform verifier are the candidates), socket options. Native targets only.
- A dial takes a URL, an optional password and a time limit, and gives an open WebSocket or an error with a code and a message.
- Refused before any network use: a scheme other than `ws` or `wss`, a URL with user information (`invalid_address`).
- The socket has `TCP_NODELAY` and keepalive (30 s idle, 10 s between probes, 3 probes where the platform allows).
- With a password the upgrade offers the subprotocol `pi-studio.bearer.<password>`; without one, none.
- Error codes: `unreachable` (name not resolved, refused, no route), `tls` with the reason (expired, unknown issuer, wrong name), `unauthorized` (401), `host_not_allowed` (403), `handshake` (any other answer), `timeout`.
- A message names the host and port and never the password. No option accepts an untrusted certificate.
- `desktop/docs/architecture.md`: "no socket below the app binary" becomes "sockets live in `net` only".

## Out of scope
- Reading and writing frames after the upgrade (task-002).
- A proxy (P6).

## Acceptance criteria
- [ ] Against local test servers: a plain one connects; one that answers 401, 403 and 500 gives the three codes; one that never answers gives `timeout` at the limit; a closed port gives `unreachable`.
- [ ] Against local TLS servers with certificates made in the test: an unknown issuer, an expired certificate and a wrong name each give `tls` with the matching reason.
- [ ] With a marker password, no error, message or log line contains it, and the server saw the bearer subprotocol.
- [ ] A URL with user information or another scheme is refused without a connection attempt.
- [ ] The licences of the crates added are listed in the summary; the three runners' builds need no extra tool (or the summary says which).
- [ ] `cargo xtask ci` passes, including the wasm step (the crate stays empty there).

## Test / verification plan
- `cargo test -p pistudiodesktop-net`
- `cargo xtask ci` in `desktop/`

## Notes
- `ring`'s licence is a mix of ISC-style and OpenSSL-derived terms: read it against rule 9 and say what you found.
- The daemon checks the `Host` header against `PI_STUDIO_HOSTNAMES` and does not check `Origin`: send `Host` from the URL as a browser would.
