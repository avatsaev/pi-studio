# Task 001 — Relay crypto + symmetric channels

- **Sprint:** sprint-032-relay-e2ee
- **Status:** backlog
- **Estimated size:** M
- **Depends on:** task-001 (sprint-004, keypair)

## Goal
Implement the relay package's encrypted channel primitives and the symmetric client/daemon channel
API.

## Scope references
- `clean-room-scope/architecture/relay-e2ee.md` § Channel API, § Handshake frames, § Behavior (per-message wire)
- `clean-room-scope/MAIN-SCOPE.md` § 2 (Relay crypto)

## What to build
- `packages/relay/src/`: `createClientChannel(...)`, `createDaemonChannel(...)` exposing an identical
  API; `Transport`, `EncryptedChannelEvents`, `ConnectionRole`, `RelaySessionAttachment` types.
- Handshake: client generates a FRESH ephemeral Curve25519 keypair; `e2ee_hello { ephemeralPublicKey }`
  (client→daemon) / `e2ee_ready` (daemon→client). Daemon refuses ANY app message until handshake done.
- Shared key = ECDH(local secret, remote public) (Curve25519). Per message:
  `box(plaintext, random24-nonce, sharedKey)` (XSalsa20-Poly1305) → frame =
  `base64([24-byte nonce] ++ ciphertext)`; receive → split → `box_open` → reject on auth failure.

## Out of scope
- Daemon outbound dial wiring (task-002). Client transport integration (task-003). CF server (task-004).

## Acceptance criteria
- [ ] A client cannot exchange app messages until `e2ee_hello`/`e2ee_ready` completes.
- [ ] Messages are `base64([24-byte nonce][ciphertext])` and authenticate under the ECDH shared key.
- [ ] Tampering with ciphertext causes rejection.
- [ ] Two separate sessions derive independent keys (cross-session replay fails).

## Test / verification plan
- Tests: `npx vitest run packages/relay/.../channel.test.ts` — handshake gating, round-trip encrypt,
  tamper reject, cross-session key independence.

## Notes
- In-session replay protection is NOT implemented (random nonces, no counter) — confirm before
  relying on it (TODO(verify)).
