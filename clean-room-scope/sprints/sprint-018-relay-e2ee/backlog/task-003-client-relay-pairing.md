# Task 003 — Client relay transport + pairing (QR fragment)

- **Sprint:** sprint-018-relay-e2ee
- **Status:** backlog
- **Estimated size:** S
- **Depends on:** task-001; task-001 (sprint-007, DaemonClient transport abstraction)

## Goal
Implement the client-side relay E2EE transport and the pairing-URL/QR flow that transfers the
daemon's public key safely.

## Scope references
- `clean-room-scope/architecture/relay-e2ee.md` § Pairing, § Behavior
- `clean-room-scope/architecture/client-app-runtime.md` § Layered client library (relay transport)

## What to build
- Client relay transport plugged into the `DaemonClient` transport abstraction (symmetric with the
  direct-WS transport): connect to the relay with the session id, generate a fresh ephemeral keypair,
  complete `e2ee_hello`/`e2ee_ready`, then carry encrypted app frames.
- Pairing: parse `https://app.pi-studio.sh/#offer=<...>` — the daemon public key rides in the URL
  **fragment** (never sent to the web server). Render/scan as a QR code; treat the key like a
  password (trust anchor).

## Out of scope
- CF relay server (task-004). App pairing UI polish.

## Acceptance criteria
- [ ] A relay-profile connection completes the E2EE handshake before any app RPC.
- [ ] The pairing key is carried in the URL fragment and never reaches the web origin.
- [ ] The relay transport is interchangeable with the direct transport via the same API.

## Test / verification plan
- Tests: `npx vitest run packages/client/.../relay-transport.test.ts` — handshake-before-RPC, fragment
  parsing, transport-API parity (against task-002 daemon transport via a fake relay).

## Notes
- Exact bytes/encoding of the `offer` fragment are TODO(verify).
