# Task 004 — Cloudflare relay server adapter

- **Sprint:** sprint-032-relay-e2ee
- **Status:** backlog
- **Estimated size:** S
- **Depends on:** task-002, task-003

## Goal
Implement the zero-knowledge relay server adapter (Cloudflare Workers) that bridges daemon and client
channels without seeing plaintext.

## Scope references
- `clean-room-scope/architecture/relay-e2ee.md` § Channel API (Cloudflare adapter), § Purpose, § Error Handling
- `clean-room-scope/MAIN-SCOPE.md` § 6 (Relay integration)

## What to build
- A Cloudflare Workers adapter that: accepts a daemon's outbound registration with a session id;
  accepts client connections for that session id; bridges frames between the two sides verbatim
  (it only ever sees ciphertext + plaintext public keys in the handshake).
- Routing/session-id assignment so a client meets the right daemon.
- Forward `e2ee_hello`/`e2ee_ready` and encrypted frames without inspection or modification.

## Out of scope
- Hosted deployment/ops. The Go self-hosted implementation (alternate; out of scope here).

## Acceptance criteria
- [ ] A daemon registers a session id and a client attaches to the same session and is bridged.
- [ ] The relay forwards frames verbatim and cannot read/forge/inject (no shared key).
- [ ] Relay restart/drop → client and daemon reconnect into a new session with new keys.

## Test / verification plan
- Tests: `npx vitest run packages/relay/.../cf-adapter.test.ts` (or Workers test harness) — register,
  attach, verbatim bridge, no-plaintext-access assertion.

## Notes
- Relay routing/session-id assignment protocol details are TODO(verify).
