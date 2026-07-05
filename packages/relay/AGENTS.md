# `@av-pi-studio/relay` — AGENTS.md

End-to-end encrypted bridge channels for remote daemon access.

> **Status: placeholder — implementation planned for a later sprint.**
> The current source exports only a package identifier constant.

---

## Intended purpose

The relay package will provide an **E2EE transport** that allows clients to connect to a
Pi-Studio daemon from outside the local network — through a relay server — without exposing the
daemon directly to the internet or requiring port forwarding.

The relay is a `Transport` implementation (see `@av-pi-studio/client`) that wraps a relay-server
channel and presents the same `connect/send/close/onMessage` interface as the direct WebSocket
transport. The daemon and all clients above `relay` remain unaware of whether they are
communicating directly or via the relay.

---

## Planned design (from `clean-room-scope/architecture/relay-e2ee.md`)

- **Keypair pairing**: the daemon generates an Ed25519 keypair at first start; the public key is
  encoded into the pairing URL / QR code printed by `pi-studio daemon start`.
- **Channel encryption**: data is encrypted end-to-end using `tweetnacl` (already a server
  dependency) so the relay server never sees plaintext frames.
- **Relay endpoint format**: `relay://relayHost[:port]/<relayId>?…` — parsed by
  `parseEndpoint()` in `@av-pi-studio/protocol`.
- **`Transport` adapter**: `createRelayTransport(endpoint, keypair)` returns a `Transport`
  injected into `DaemonClient` in place of the direct WebSocket transport.
- **CLI integration**: `pi-studio daemon pair` already constructs the pairing URL via
  `buildPairingUrl()` in `@av-pi-studio/cli`; the relay transport will consume the same URL.

---

## Current source

```
src/
  index.ts    export const RELAY_PACKAGE = "@av-pi-studio/relay"
```

---

## When implementing this sprint

1. Read `clean-room-scope/architecture/relay-e2ee.md` in full before writing any code.
2. Add `tweetnacl` (or re-export from server) as a dependency if needed.
3. Implement `createRelayTransport(endpoint, keypair): Transport` and export it from `index.ts`.
4. The `Transport` interface lives in `@av-pi-studio/client/src/transport.ts` — import from there.
5. Do **not** import from `@av-pi-studio/server`. The relay package must be usable by clients
   (browser, RN, CLI) with no server-side deps.
6. Write tests with an in-memory relay stub (no real relay server needed).

---

## Key invariants (for future implementation)

- **Zero server deps.** This package is used by clients; never import `@av-pi-studio/server`.
- **Implements `Transport`** from `@av-pi-studio/client` exactly — no method additions or removals.
- **Encryption is mandatory.** A relay transport that sends plaintext is a security violation.
- **Relay server is untrusted.** The relay server sees only ciphertext; it cannot read or modify
  agent events.
