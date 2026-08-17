# Relay & End-to-End Encryption — Clean Room Scope

> Part of: [MAIN-SCOPE.md](../MAIN-SCOPE.md)
> Related scopes: [auth-security.md](auth-security.md), [websocket-protocol.md](websocket-protocol.md),
> [daemon-bootstrap.md](daemon-bootstrap.md)

## Purpose

The relay lets clients reach a daemon that is behind a firewall/NAT without opening inbound ports.
The daemon dials **outbound** to a relay server; clients meet it there. The relay is **untrusted and
zero-knowledge**: all application traffic between client and daemon is end-to-end encrypted, so a
compromised relay can see only metadata (IPs, timing, sizes, session ids, and the plaintext public
keys in the handshake) — never message contents, and it cannot forge or inject commands.

## Public Contract

### Channel API (relay package)
| Name | Role | Purpose |
|------|------|---------|
| `createClientChannel(...)` | client | Client side of an encrypted relay channel |
| `createDaemonChannel(...)` | daemon | Daemon side of an encrypted relay channel |
| `Transport`, `EncryptedChannelEvents` | both | Transport abstraction + event types |
| `ConnectionRole`, `RelaySessionAttachment` | both | Role + attachment types |
| Cloudflare adapter | server | Relay server implementation hook for Cloudflare Workers |

Both channels expose an identical API so the daemon and client use symmetric code paths.

### Pairing
- The daemon's persistent Curve25519 public key is transferred to the client via a **pairing URL**
  rendered as a QR code: `https://app.pi-studio.sh/#offer=<...>`. The key rides in the **URL fragment**,
  which is never sent to the web server — `app.pi-studio.sh` never sees the key.
- When the daemon dials an outbound relay (`daemon.relay.enabled`), the pairing URL instead (or
  additionally) carries the relay's client-facing endpoint: `#offer=<...>&relay=<endpoint>
  &relayTls=<0|1>`. A pairing URL carries EITHER `host=<direct-host>` OR `relay=`/`relayTls=`, never
  both — a relay-only daemon (behind a firewall/NAT) has no reachable direct host to offer.
- The QR/link is the trust anchor; treat it like a password. On a relay-routed connection the
  `offer=` key IS the credential — no password is consulted — and the rendezvous id is
  `deriveRelaySessionId(publicKey)`, deterministic for the life of the key. A leaked link therefore
  stays valid until the key is replaced: **`pi-studio daemon rotate-key`** is the revocation path
  (stops the daemon, deletes `daemon-keypair.json`, restarts so a fresh identity is minted, prints
  the new QR). Every previously-issued link/QR dies with the old key — its derived session id is no
  longer registered on the relay — so all clients must re-pair. `config.json` (password hash, relay
  config) is untouched.

### Handshake frames (plaintext, observed by relay)
| Frame | Direction | Contents |
|-------|-----------|----------|
| `e2ee_hello` | client → daemon | client's fresh ephemeral public key |
| `e2ee_ready` | daemon → client | handshake acknowledgement |

### App traffic frames (ciphertext, observed by relay)
| Frame | Payload | Purpose |
|-------|---------|---------|
| `e2ee_app` | `base64([24-byte nonce][ciphertext of UTF-8 text])` | RPC/control messages (same shape as the direct-WS `hello`/`session`/`ping` envelopes) |
| `e2ee_bin` | `base64([24-byte nonce][ciphertext of raw bytes])` | Binary application data — terminal I/O, file-transfer chunks. Identical crypto/gating to `e2ee_app`; still a JSON text WS frame, never a raw binary WebSocket frame, so the relay's zero-knowledge bridging (which only ever inspects the very first `relay_register` frame) needed no changes to carry it. |

## Behavior & Algorithms

```
# Daemon identity (once per $PI_STUDIO_HOME)
keypair = libsodium box keypair                  # Curve25519
persist { v: 2, publicKeyB64, secretKeyB64 } at $PI_STUDIO_HOME/daemon-keypair.json (mode 0600)

# Connection setup
daemon: dial outbound WebSocket to relay endpoint; register session id =
        deriveRelaySessionId(daemon's persistent public key)          # deterministic, NOT random —
                                                                        # same id every (re)connect,
                                                                        # so a pairing link printed
                                                                        # once keeps working across
                                                                        # relay drops/restarts
client: connect to relay with the SAME session id (derived from the pairing offer's public key, or
        an explicit sessionId if one was separately transmitted); generate FRESH ephemeral
        Curve25519 keypair
client → daemon: e2ee_hello { ephemeralPublicKey }
daemon: refuses to process ANY application message until handshake completes; a NEW e2ee_hello
        received at ANY point (even after handshake already completed once) re-runs the handshake
        from scratch — the relay lets multiple client sockets attach to one session id over the
        daemon's process lifetime (browser reload, second tab, reconnect), and the daemon must not
        permanently lock onto the first one
both: sharedKey = ECDH(local secret, remote public)     # Curve25519
daemon → client: e2ee_ready

# Per-message wire format after handshake
plaintext → box(plaintext, nonce=random24, sharedKey)   # XSalsa20-Poly1305
frame = base64( [24-byte nonce] ++ ciphertext )         # sent as WS text frame
receive → split nonce/ciphertext → box_open → reject if authentication fails
```

- **Daemon secret never leaves the daemon.** The client keypair is ephemeral per connection, so
  there is no persistent client-side secret to steal.
- **Session key freshness:** each CONNECTION derives fresh keys from a fresh client ephemeral
  keypair, so ciphertext cannot be replayed across connections — this holds even though the
  rendezvous session id is now deterministic (see Connection setup above): the session id is a
  non-secret routing label the relay uses to pair sockets, never a key input, so it repeating
  across reconnects does not weaken key freshness. **Within** a live connection, replay protection
  is *not* implemented (random nonces, no counter / no nonce-reuse tracking).
- **TLS:** self-hosted relays use `ws://` unless TLS is opted in via `daemon.relay.useTls` /
  `PI_STUDIO_RELAY_USE_TLS`. The public (client-facing) TLS setting can be set independently via
  `daemon.relay.publicUseTls` / `PI_STUDIO_RELAY_PUBLIC_USE_TLS`. Config fields: `endpoint`,
  `publicEndpoint`, `useTls`, `publicUseTls`, `enabled`.

## Data & Persistence
- `$PI_STUDIO_HOME/daemon-keypair.json` — `{ v: 2, publicKeyB64, secretKeyB64 }`, mode `0600`,
  regenerated if unreadable or absent (the latter is how `daemon rotate-key` forces rotation).

## Error Handling & Edge Cases
| Condition | Expected behavior |
|-----------|-------------------|
| App message before handshake completes | Daemon refuses to process |
| Tampered ciphertext | Authenticated decryption fails → message rejected |
| Relay compromised/malicious | Cannot read, forge, or inject (no shared key without daemon secret) |
| Relay restarts / drops | Client/daemon reconnect under the SAME deterministic session id (`deriveRelaySessionId`); fresh ephemeral keypair on both sides → new shared key, even though the session id is unchanged |
| A different client attaches to the same session id while the daemon's channel is already `ready` (browser reload, second tab, plain reconnect) | Daemon channel re-arms: re-derives the shared key from the NEW `e2ee_hello`, replies `e2ee_ready` again, and the daemon drops any app-level session state tied to the previous peer — it does NOT latch onto the first client forever |
| Unreadable keypair file | Regenerate (invalidates existing pairings) |

## Dependencies
- Internal: relay-transport (daemon side), daemon-client relay transport (client side).
- External: libsodium / NaCl box, Cloudflare Workers (hosted relay), WebSocket.

## Acceptance Criteria
- [ ] Daemon generates and persists a Curve25519 keypair at mode `0600` on first run.
- [ ] A client cannot exchange application messages until `e2ee_hello`/`e2ee_ready` completes.
- [ ] Messages are `base64([24-byte nonce][ciphertext])` and authenticate under the ECDH shared key.
- [ ] Tampering with ciphertext causes rejection.
- [ ] Two separate sessions derive independent keys (cross-session replay fails).
- [ ] The pairing key is carried in the URL fragment and never reaches the web origin.
- [x] A SECOND (and Nth) client connecting under the same session id after an earlier one
  disconnected completes its own handshake — the daemon does not permanently lock onto the first
  client it ever paired with. Verified: `packages/relay/src/session-bridge.test.ts` (in-process
  regression) and a real docker-compose smoke test (two sequential browser connections through a
  live self-hosted relay).
- [x] Terminal I/O and file-transfer chunks (binary application data) work over a relay
  connection, not just text RPC — carried as the `e2ee_bin` frame, same handshake gating and
  ECDH shared key as `e2ee_app`. Verified: `packages/relay/src/channel.test.ts` (unit),
  `packages/client/src/relay-transport.test.ts` and `packages/server/src/daemon/
  bootstrap.test.ts` (real relay bridge + real E2EE handshake + real RPC round-trip), and a
  live docker-compose smoke test (real browser typing into a real terminal through a real
  self-hosted relay, receiving real shell output back).

## TODO(verify)
- [ ] Exact bytes/encoding of the pairing `offer` fragment.
- [ ] Whether in-session replay protection has since been added.
