# Task 001 — Relay crypto + symmetric channels — Summary

- **Sprint:** sprint-032-relay-e2ee
- **Completed:** 2026-07-18
- **Status:** done

## What was implemented
A new `packages/relay` package providing the E2EE channel primitives shared by the daemon and
client: `createDaemonChannel(...)` and `createClientChannel(...)` expose an identical
`EncryptedChannel` API over an abstract `Transport` (send/receive text frames — the concrete relay
WebSocket wiring is out of scope here, per task-002/003).

- Handshake: client generates a FRESH ephemeral Curve25519 keypair and sends
  `{"type":"e2ee_hello","ephemeralPublicKey":"<base64>"}`; the daemon (using its PERSISTENT
  identity keypair, not a throwaway one — see below) derives the shared key via
  `nacl.box.before(clientEphemeralPublic, daemonSecret)`, replies
  `{"type":"e2ee_ready"}`, and only then accepts app traffic. The client independently derives the
  same shared key immediately (it already knows the daemon's persistent public key from the
  pairing offer) but likewise gates its own `send()` on receiving `e2ee_ready`.
- Per-message wire format: `{"type":"e2ee_app","frame":"<base64(24-byte nonce ++ ciphertext)>"}`,
  `ciphertext = nacl.box.after(utf8(plaintext), nonce, sharedKey)` (XSalsa20-Poly1305 via
  `tweetnacl`). Receive path splits nonce/ciphertext, calls `nacl.box.open.after`; on auth failure
  the frame is silently dropped and `onAuthError` fires — never a thrown exception into the
  transport's message loop (a hostile/buggy relay must not be able to crash either side).
- A pure-JS base64 codec (`base64.ts`, no Node `Buffer`) so the whole package runs identically in
  the daemon (Node) and a future browser/RN client transport (task-003), matching the existing
  cross-platform convention in `packages/protocol`'s binary-frame codecs.

### Design correction made during implementation
The task notes describe the daemon "deriving the shared key from the client's ephemeral public
key" without specifying which daemon-side key. Cross-checking
`architecture/relay-e2ee.md` § Pairing + § Behavior confirmed the daemon's **persistent**
Curve25519 identity key (the one transferred to the client via the pairing QR/URL fragment) must
be used for ECDH — not a fresh per-connection keypair — otherwise the client (which derives its
shared key from that same persistent public key before the handshake even starts) could never
compute a matching key. `createDaemonChannel` therefore takes `daemonKeypair: { publicKey,
secretKey }` as a required option rather than generating its own.

## Files created / changed
| File | Change |
|------|--------|
| `packages/relay/package.json` | created |
| `packages/relay/tsconfig.json` | created |
| `packages/relay/AGENTS.md` | created |
| `packages/relay/src/index.ts` | created |
| `packages/relay/src/channel.ts` | created — `createClientChannel`, `createDaemonChannel`, `Transport`, `EncryptedChannelEvents`, `ConnectionRole`, `RelaySessionAttachment`, `EncryptedChannel` |
| `packages/relay/src/channel.test.ts` | created (6 tests) |
| `packages/relay/src/base64.ts` | created |
| `packages/relay/src/base64.test.ts` | created (3 tests) |
| `package.json` | added `packages/relay` to `workspaces`, added `build:relay` script, chained into `build` |
| `tsconfig.json` | added `{ "path": "./packages/relay" }` project reference |
| `AGENTS.md` | added `relay/` to monorepo layout, dependency graph, and package index |

## How it satisfies the scope
Maps to `architecture/relay-e2ee.md` § Channel API (both `create*Channel` functions + shared
types), § Handshake frames (`e2ee_hello`/`e2ee_ready` exactly as specified), § Behavior (ECDH +
XSalsa20-Poly1305 box, `base64(nonce ++ ciphertext)` wire format, gating app traffic until
handshake completes) and `MAIN-SCOPE.md` § 2 (Relay crypto: Curve25519 ECDH + XSalsa20-Poly1305
NaCl `box`, pure-JS `tweetnacl`, no libsodium native binding).

No deviations from the acceptance criteria. Cloudflare/daemon-dial/client-transport wiring is
explicitly out of scope (tasks 002–004).

## Build & test results
```
$ npm run build:relay
> tsc -b packages/relay
(clean exit, no output)

$ npx tsc -b --force          # full workspace typecheck, confirms no regressions
(clean exit, no output)

$ npx oxlint packages/relay/src
(clean exit, no warnings)

$ npx vitest run packages/relay/src/
 ✓ packages/relay/src/base64.test.ts (3 tests) 2ms
 ✓ packages/relay/src/channel.test.ts (6 tests) 23ms
 Test Files  2 passed (2)
      Tests  9 passed (9)
```

## Acceptance criteria
- [x] A client cannot exchange app messages until `e2ee_hello`/`e2ee_ready` completes — verified by
      "gates app messages until the e2ee_hello/e2ee_ready handshake completes" and "refuses to
      send before the daemon has received e2ee_hello" (`channel.test.ts`).
- [x] Messages are `base64([24-byte nonce][ciphertext])` and authenticate under the ECDH shared
      key — verified by "round-trips an encrypted app message both ways" and the base64 round-trip
      tests (`base64.test.ts`).
- [x] Tampering with ciphertext causes rejection — verified by "rejects tampered ciphertext
      without crashing and without delivering it" (asserts `onAuthError` fires, no message
      delivered, channel stays `ready`).
- [x] Two separate sessions derive independent keys (cross-session replay fails) — verified by
      "derives independent keys per session — replaying session one's ciphertext at session two's
      daemon fails auth" (captures a real app frame from session one and replays it at session
      two's daemon; asserts `onAuthError` fires once and no message is delivered).

## Follow-ups / TODO(verify)
- In-session replay protection is NOT implemented (random nonces, no counter) — carried forward
  from `architecture/relay-e2ee.md` TODO(verify); confirm before relying on it.
- The concrete relay WebSocket `Transport` implementation (daemon outbound dial, client relay
  connect) is deliberately not built here — task-002 (daemon) and task-003 (client) own that
  wiring against this package's `Transport` interface.
- `daemonKeypair`/`daemonPublicKey` are passed in by the caller; task-002 is expected to source
  `daemonKeypair` from the existing `resolveDaemonKeypair()` in
  `packages/server/src/daemon/bootstrap.ts` (same `daemon-keypair.json` shape), and task-003 from
  `readDaemonPublicKey()` in `packages/cli/src/pairing.ts` / the parsed pairing-URL fragment.
