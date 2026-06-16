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
- The QR/link is the trust anchor; treat it like a password.

### Handshake frames (plaintext, observed by relay)
| Frame | Direction | Contents |
|-------|-----------|----------|
| `e2ee_hello` | client → daemon | client's fresh ephemeral public key |
| `e2ee_ready` | daemon → client | handshake acknowledgement |

## Behavior & Algorithms

```
# Daemon identity (once per $PI_STUDIO_HOME)
keypair = libsodium box keypair                  # Curve25519
persist { v: 2, publicKeyB64, secretKeyB64 } at $PI_STUDIO_HOME/daemon-keypair.json (mode 0600)

# Connection setup
daemon: dial outbound WebSocket to relay endpoint; register session id
client: connect to relay with session id; generate FRESH ephemeral Curve25519 keypair
client → daemon: e2ee_hello { ephemeralPublicKey }
daemon: refuses to process ANY application message until handshake completes
both: sharedKey = ECDH(local secret, remote public)     # Curve25519
daemon → client: e2ee_ready

# Per-message wire format after handshake
plaintext → box(plaintext, nonce=random24, sharedKey)   # XSalsa20-Poly1305
frame = base64( [24-byte nonce] ++ ciphertext )         # sent as WS text frame
receive → split nonce/ciphertext → box_open → reject if authentication fails
```

- **Daemon secret never leaves the daemon.** The client keypair is ephemeral per connection, so
  there is no persistent client-side secret to steal.
- **Session key freshness:** each session derives fresh keys, so ciphertext cannot be replayed
  across sessions. **Within** a live session, replay protection is *not* implemented (random nonces,
  no counter / no nonce-reuse tracking).
- **TLS:** self-hosted relays use `ws://` unless TLS is opted in via `daemon.relay.useTls` /
  `PI_STUDIO_RELAY_USE_TLS`. The public (client-facing) TLS setting can be set independently via
  `daemon.relay.publicUseTls` / `PI_STUDIO_RELAY_PUBLIC_USE_TLS`. Config fields: `endpoint`,
  `publicEndpoint`, `useTls`, `publicUseTls`, `enabled`.

## Data & Persistence
- `$PI_STUDIO_HOME/daemon-keypair.json` — `{ v: 2, publicKeyB64, secretKeyB64 }`, mode `0600`,
  regenerated if unreadable.

## Error Handling & Edge Cases
| Condition | Expected behavior |
|-----------|-------------------|
| App message before handshake completes | Daemon refuses to process |
| Tampered ciphertext | Authenticated decryption fails → message rejected |
| Relay compromised/malicious | Cannot read, forge, or inject (no shared key without daemon secret) |
| Relay restarts / drops | Client/daemon reconnect; new session → new keys |
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

## TODO(verify)
- [ ] Exact bytes/encoding of the pairing `offer` fragment.
- [ ] Whether in-session replay protection has since been added.
- [ ] Relay server routing/session-id assignment protocol details.
