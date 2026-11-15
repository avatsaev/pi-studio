# Relay & End-to-End Encryption — Clean Room Scope

> Part of: [MAIN-SCOPE.md](../MAIN-SCOPE.md)
> Related scopes: [auth-security.md](auth-security.md), [websocket-protocol.md](websocket-protocol.md),
> [daemon-bootstrap.md](daemon-bootstrap.md)

> The wire format is specified in [relay-protocol.md](relay-protocol.md) (relay protocol 2, delivered
> by [../features/relay-multi-client.md](../features/relay-multi-client.md)). This file keeps
> § Pairing and § Data & Persistence.

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
| `Transport`, `ChannelEvents`, `Channel` | both | Transport abstraction, event types, channel handle |
| `parseRelayFrame`, `RELAY_CLOSE`, `RELAY_DEFAULTS` | both | Control-frame parsing, close codes, limits (`control.ts`) |
| `deriveRelaySessionId` | both | Session id from the daemon public key |

Both channels expose an identical API so the daemon and client use symmetric code paths. The relay
server (`relay-server.ts`, Node-only) is not re-exported from the package index.

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

### Wire format
See [relay-protocol.md](relay-protocol.md): control frames (`relay_daemon_register`,
`relay_client_connect`, `relay_dial`, `relay_daemon_attach`, `relay_paired`) are JSON text frames used
only until pairing; after `relay_paired` every frame is a binary NaCl-box frame. There are no
`e2ee_*` frames.

## Behavior & Algorithms

The wire (control frames, close codes, the channel `hello`/`ready` frames, record kinds, counter
nonces, the daemon's salt, limits and timers) is specified in [relay-protocol.md](relay-protocol.md).
This file keeps only identity and the security properties.

```
# Daemon identity (once per $PI_STUDIO_HOME)
keypair = NaCl box keypair (tweetnacl)           # Curve25519
persist { v: 2, publicKeyB64, secretKeyB64 } at $PI_STUDIO_HOME/daemon-keypair.json (mode 0600)

# Rendezvous
sessionId = deriveRelaySessionId(daemon's persistent public key)   # deterministic, NOT random:
                                                                     # a pairing link printed once
                                                                     # keeps working across relay
                                                                     # drops and restarts
daemon: control socket registers sessionId; opens one data socket per client connection
client: connects with the SAME sessionId (derived from the pairing offer's public key) and a FRESH
        ephemeral Curve25519 keypair, per connection
sharedKey = box.before(remote public, local secret)     # Curve25519 ECDH
```

- **Daemon secret never leaves the daemon.** The client keypair is ephemeral per connection, so
  there is no persistent client-side secret to steal.
- **Key freshness and replay:** each CONNECTION uses a fresh client ephemeral keypair. The session id
  is a non-secret routing label, never a key input. The shared key depends only on the daemon's
  long-lived key and the client's key, so a recorded `hello` presented again would derive the same
  key; the daemon's random per-connection salt in the nonce prevents nonce reuse. **Within** a live
  connection, each direction uses a counter nonce and a receiver accepts only the next counter, so
  replay, reordering and reflection close the connection. A client proves the other end holds the
  daemon's secret by opening the `ready` box.
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
| Application message before the channel is ready | Not possible: the client sends nothing before opening `ready`; the daemon opens no session before a valid channel `hello` |
| Tampered, reordered or replayed ciphertext | Authenticated decryption with the expected counter fails → close `4200 channel_error`, nothing delivered |
| Relay compromised/malicious | Cannot read, forge, inject, replay or reorder (no shared key without the daemon secret); can drop or delay frames, which closes or stalls the connection |
| Relay restarts / drops | Daemon redials its control socket under the SAME deterministic session id; each client reconnects with a fresh ephemeral keypair → new shared key and a fresh daemon-chosen salt |
| A second client connects while others are paired | Gets its own data socket and daemon session; existing connections are untouched |
| Replayed client `hello` on a new connection | Same shared key, but the daemon's fresh salt keeps every nonce distinct |
| Unreadable keypair file | Regenerate (invalidates existing pairings) |

## Dependencies
- Internal: `packages/relay` (`channel.ts`, `control.ts`, `session-id.ts`), the daemon's
  `relay-transport.ts` / `relay-connection.ts`, the client's `relay-transport.ts`.
- External: `tweetnacl` (NaCl box), WebSocket. The relay server is
  self-hosted (`packages/relay/src/relay-server.ts`); there is no hosted-platform adapter.

## Acceptance Criteria
- [x] Daemon generates and persists a Curve25519 keypair at mode `0600` on first run.
- [x] A client cannot exchange application messages until it has opened the daemon's `ready` box.
- [x] Messages are boxes under the ECDH shared key with a counter nonce; tampering, reordering or
  replay closes the connection with `channel_error` (see [relay-protocol.md](relay-protocol.md) § 4).
- [x] Two connections derive independent nonce streams even under a repeated client key (the daemon's
  per-connection salt).
- [x] The pairing key is carried in the URL fragment and never reaches the web origin.
- [x] A second (and Nth) client under the same session id gets its own daemon socket and daemon
  session; the daemon never locks onto the first client (up to 32 per daemon).
- [x] Terminal I/O and file-transfer chunks (binary application data) work over a relay
  connection as binary channel records.

## TODO(verify)
- [ ] Exact bytes/encoding of the pairing `offer` fragment.
- [x] In-session replay protection: added by relay protocol 2 (counter nonces, strict order).
