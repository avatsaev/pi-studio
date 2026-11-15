# Grill — Relay multi-client

> Status: grilled
> Started: 2026-11-15   Last updated: 2026-11-15   Rounds: 5
> Engineer: avatsaev   Agent: omp / Claude

## Raw idea
Proposed by the agent in the Pi Studio Desktop feasibility discussion (2026-11-15) and accepted by
the engineer for grilling ("let's create the scope for 1, then we will grill the scope 2"):

"Relay multi-client — Connection ids in the relay, and one encrypted channel and session per client
on the daemon. Real binary frames instead of base64 in JSON."

Constraints already set by the engineer in that discussion: breaking wire changes are acceptable
(the user base is small); `pi-studio-dashboard` is not a compatibility constraint; Linux, macOS and
Windows are all targets for the desktop client.

## Codebase context
Read in code at pi-studio 0.0.118. "Inferred" marks a conclusion drawn from the code that was not
run.

| Area | Path(s) | Fact that matters |
|------|---------|-------------------|
| Relay bridge | `packages/relay/src/session-bridge.ts` | Sockets register with a first frame `{type:"relay_register", sessionId}`. Every later frame is forwarded verbatim to **every other socket** with that session id. No roles: daemon and clients are indistinguishable, so a client's frames also reach the other clients |
| Daemon channel | `packages/relay/src/channel.ts` (`createDaemonChannel`) | One `sharedKey` per relay socket. Every `e2ee_hello` re-derives it ("last hello wins"), so a second client evicts the first |
| Daemon session | `packages/server/src/daemon/bootstrap.ts` (relay block) | One `relaySession` variable. `onHandshake` disposes the previous session (subscriptions, transfers) and the next `hello` creates a new one |
| Two clients at once | the three files above | Inferred: the evicted client's pings no longer decrypt, its liveness check fails, it reconnects and evicts the other; two relay clients take turns evicting each other |
| Daemon dial | `packages/server/src/daemon/relay-transport.ts` | One outbound socket per daemon. On `close` it redials **immediately, with no delay or backoff**. Binary WebSocket frames are ignored |
| Relay server | `packages/relay/src/relay-server.ts` | Node `ws` 8.21 server plus `GET /health`. Ignores binary frames. No flow control: `ws.send` without looking at the queue (`ws` has `pause()`/`resume()`). No registration timeout, no per-session or per-address limit, default `maxPayload`. Any socket may register any session id. Logs session ids at `info` |
| Wire format | `packages/relay/src/channel.ts` | `e2ee_app` / `e2ee_bin`: JSON text frames carrying `base64(24-byte random nonce ++ box)`. Binary application data (terminal, file chunks) is base64 inside JSON |
| Crypto | `packages/relay/src/channel.ts` | Shared key = ECDH(daemon static key, client ephemeral key), used in both directions with random nonces. No in-session replay protection (documented). Inferred: a frame reflected back to its sender decrypts, because both directions use one key. `e2ee_ready` is an unauthenticated plaintext frame. Only dependency: `tweetnacl` |
| Client transport | `packages/client/src/relay-transport.ts` | `connect()` resolves on `e2ee_ready`. No timeout: with the daemon offline it never settles (`DaemonClient.connect` has none either). Reports the relay socket's `bufferedAmount` |
| Download pacing | `packages/server/src/ws/session.ts`, `files/file-transfer.ts` | Pacing reads `session.bufferedAmount`. The relay session's stand-in socket has only `send`, so relay downloads are unpaced |
| Liveness | `relay-server.ts`, `relay-transport.ts` (daemon) | No WebSocket ping on either relay hop. A daemon with no client attached has an idle socket; a half-open one is never detected |
| Credential | `swe/architecture/relay-e2ee.md` § Pairing, `packages/cli/src/pairing.ts` | The pairing link's `offer` (the daemon's Curve25519 public key) is the only credential on the relay path; no password. Session id = first 16 bytes of SHA-512(public key). Revocation = `pi-studio daemon rotate-key`, which unpairs every client |
| Relay clients | `packages/workbench/src/host/browser-connection.ts`, `lib/connection/resolve-connect-target.ts` | The workbench is the only relay client in the repository. The CLI has a transport injection point but no pairing-link path |
| Hosted relay | `docker/relay.Dockerfile`, `.github/workflows/release.yml`, `docker/README.md` | Production relay is the Node server in Docker on Dokploy (`relay.molagent.ai`), redeployed with the web client on every release. Daemons update when their users do |
| Cloudflare adapter | `packages/relay/src/cf-adapter.ts` | A structural wrapper over `WebSocketPair` with four unit tests. No `wrangler` config or deployment exists; `relay-e2ee.md` still names Cloudflare Workers as the hosted relay |
| Tests | `packages/relay/src/*.test.ts`, `packages/client/src/relay-transport.test.ts`, `packages/server/src/daemon/relay-transport.test.ts`, `docker/docker-compose.yml` | 40 relay-package tests, 12 client, 5 daemon; a compose stack runs daemon + relay + web client locally |
| Related scope | `swe/features/desktop-client-protocol-followups-2.md` | `hello.agentStreams: "none"` and ranged, cancellable downloads. The desktop client's second, Rust-owned connection relies on both, and on a relay it also needs this feature |
| Noise libraries (checked 2026-11-15, after D2) | npm registry, crates.io | Rust: `snow` 0.10 (Apache-2.0 OR MIT) supports NK with 25519, ChaChaPoly, SHA256/BLAKE2s/BLAKE2b. TypeScript: `noise-handshake` 4.2 (Apache-2.0, maintained) implements only NN, XX and IK, fixes the hash to BLAKE2b and depends on `sodium-universal`, which loads the native addon `sodium-native` in Node. `noise-protocol` was last published in 2023. `@chainsafe/libp2p-noise` is XX only and tied to libp2p. `@noble/curves`, `@noble/ciphers`, `@noble/hashes` 2.4 (MIT, no dependencies, pure JS) provide X25519, ChaCha20-Poly1305 and BLAKE2s/SHA-256 but no Noise state machine |
| Noise limits | Noise specification | A Noise message is at most 65 535 bytes. A 32 KiB file chunk fits; JSON messages can be far larger (inline file reads up to 5 MiB), so large messages need splitting |

## Problem & outcome
- **Who:** anyone reaching a daemon through the relay from more than one client at a time (phone
  and browser, two tabs, two windows), and Pi Studio Desktop, which holds two connections per
  window (the workbench's and a Rust-owned one for transfers and notifications).
- **Today:** one client per daemon on the relay; a second one evicts the first. Binary data is
  base64 in JSON and relay downloads are unpaced.
- **Done means:** several clients use one daemon through the relay at the same time, each with its
  own encrypted channel and its own daemon session; binary data crosses the relay as binary frames
  and a large transfer is paced as it is on a direct connection (D1); the handshake is Noise NK
  (D2).
- **Measured by:** the acceptance criteria below; for transfers, correctness and bounded memory,
  with throughput recorded but not gated (D18).

## Goals
- One encrypted channel and one daemon session per relay client; no client evicts another (D1).
- Transfer parity with a direct connection: real binary frames, and backpressure through the relay
  so the daemon's download pacing works (D1).
- Replace the hand-written handshake and random-nonce framing with the Noise NK pattern (D2).

## Non-goals
- Keeping the current relay protocol alive: relay and clients speak only the new one (D3).
- A Cloudflare Workers relay (D4).
- Relay access from the CLI: only the workbench (and the desktop client) use pairing links (D12).

## Happy path
Confirmed by the engineer in round 2 (D8).

1. The daemon dials the relay and registers as the daemon for its session id (derived from its
   public key, as today). This is its **control socket**.
2. A client dials the relay and asks for that session id.
3. The relay creates a random connection id and sends it to the daemon on the control socket.
4. The daemon dials a new socket quoting the connection id. The relay pipes it to the client's
   socket and from then on forwards frames unread, binary included, pausing one side while the
   other is congested.
5. Client and daemon run the Noise NK handshake (one round trip, as today).
6. The client sends `hello`; the daemon creates a session for this connection and answers
   `server_info`, exactly as on a direct connection.
7. When either side closes, the relay closes the other half and the daemon disposes only that
   session.

## Decisions
| # | Theme | Question | Decision | Rationale | Round |
|---|-------|----------|----------|-----------|-------|
| D1 | scope | Is transfer parity part of this feature? | Yes: multi-client **plus** real binary frames and backpressure through the relay | A large transfer must behave as on a direct connection; the desktop client's transfer engine depends on it | 1 |
| D2 | scope | Fix the encryption weaknesses while the wire changes? | Replace the handshake with **Noise NK** from existing libraries | Engineer's choice over the agent's recommendation (per-direction counters on the existing NaCl box). Covers replay, reflection, reordering and forward secrecy in one standard construction | 1 |
| D3 | compatibility | Must an outdated daemon keep working through the new relay? | No: **hard cut**. A client that reaches an outdated daemon is told to update it. The relay leaves old daemons connected but idle | Small user base. Old daemons redial with no delay when closed, so closing them would flood the relay | 1 |
| D4 | scope | What happens to the Cloudflare adapter? | **Deleted** | Nothing deploys it; production is the Node relay on Dokploy | 1 |
| D5 | integration | No maintained TypeScript Noise library offers NK. Which wins? | **Keep Noise NK.** Primitives from `@noble` (X25519, ChaCha20-Poly1305, hash); the NK handshake logic is written in this repository (about 300 lines) and proven with the published Noise test vectors and a handshake against `snow`. Rust uses `snow` unchanged | Resolves the contradiction in D2: "existing libraries" holds for the primitives and for Rust, not for the TypeScript state machine. The alternatives were another pattern through `noise-handshake` (needs a client key pair, adds a native addon to the daemon) or NaCl box with counters (no forward secrecy) | 2 |
| D6 | integration | How does the relay keep clients apart? | **One daemon socket per client.** The daemon keeps a control socket; for each arriving client the relay tells the daemon, which dials a dedicated socket that the relay pipes to the client | Ordinary TCP backpressure per client: the daemon's existing download pacing works unchanged and a slow client cannot stall another. The alternative (one shared socket with tagged frames) needs a credit-based flow-control scheme. Cost: one extra dial per client connect | 2 |
| D7 | edge case | A client connects while the daemon is offline | The relay **refuses at once** with a distinct "daemon offline" reason; the client shows it and its reconnect loop retries | Today the connect attempt never settles. Holding the client for a grace period was rejected | 2 |
| D8 | happy path | Is the proposed seven-step happy path right? | Confirmed as written under § Happy path | | 2 |
| D9 | data | Do existing pairing links survive the change? | ~~No: new identity and link format; every client pairs again~~ **Reversed by D14 in round 4** | Chosen in round 3 over the agent's recommendation, then withdrawn by the engineer when asked what the new format must deliver | 3 |
| D10 | scale | How many clients may one daemon have on the relay at once? | **32.** The relay refuses the next one with a "too many clients" reason | The desktop client uses two connections per window | 3 |
| D11 | integration | How is the contract pinned for the Rust client? | **Fixtures with fixed keys** in the existing external-client fixtures: handshake messages, a few encrypted records, the relay's control messages | The Rust client can be tested without a live relay | 3 |
| D12 | scope | Does the CLI learn to connect through the relay? | **No**, out of scope | | 3 |
| D13 | data | Are the proposed data rules right? | Confirmed as written under § Data & state | | 3 |
| D14 | data | What must the new pairing identity deliver? | **Nothing: D9 is withdrawn.** The key file, the link format and the session-id derivation stay as they are. Links and QR codes already issued keep working once daemon and client are both updated | Engineer: "i would like to go back on my decision of chosing new identity and link format". The agent then tested that a key generated the way `daemon-keypair.json` is today gives the same public key and the same X25519 result with `@noble/curves` (200 of 200 random keys) | 4 |
| D15 | edge case | The daemon's control socket drops while clients are connected | **Connected clients keep running** on their own sockets; only new clients get "daemon offline" until the daemon registers again | Closing every connection on a network blip was rejected | 4 |
| D16 | compatibility | A browser tab still running the old web client | **Left connected and idle**, like an old daemon; it stays on "connecting" until reloaded | The relay needs no knowledge of the old protocol beyond recognising it. Detecting old clients and closing them with a reason was rejected | 4 |
| D17 | edge case | Are the twelve proposed behaviours for the remaining cases right? | Confirmed; they are the rows marked D17 under § Edge cases & failure modes | | 4 |
| D18 | performance | How is transfer performance through the relay judged? | **Correctness and bounded memory only.** A 600 MiB transfer each way through a local relay finishes with a matching hash while relay and daemon memory stay far below the file size. Throughput is recorded next to the direct-connection figures, with no pass mark | A throughput pass mark (half of direct speed on loopback) was rejected | 5 |
| D19 | security | Relay abuse limits beyond the frame size cap, the 10 s identification limit and 32 clients per daemon | **Nothing more for now** | A per-address socket cap was rejected. Whether the hosted relay sees real client addresses behind its reverse proxy was not checked | 5 |
| D20 | observability | What does the relay report about itself? | **Structured logs only**, one line per connection: connection id, session id, time to pair, bytes each way, duration, close reason | A statistics endpoint next to `/health` was rejected | 5 |
| D21 | rollout | Are the proposed rollout, rollback and privacy rules right? | Confirmed as written under § Non-functional constraints | | 5 |
| D22 | acceptance | Are the thirteen proposed acceptance criteria right? | Confirmed as written under § Acceptance criteria | | 5 |

## Data & state
Confirmed by the engineer in round 3 (D13), except the identity and link format, which D9 replaces.

- **Records.** After pairing, every WebSocket frame is one encrypted Noise record of at most
  65 535 bytes (a limit of Noise itself). A larger application message is split into several
  records and reassembled on arrival. The relay closes a connection that sends a larger frame.
- **Text or binary** is marked inside the encryption; the relay cannot tell them apart.
- **Relay state** is in memory only: which control socket serves which session id, and which two
  sockets form a connection. Nothing is persisted; a relay restart drops every connection.
- **Daemon sessions.** One session per relay connection; `daemon_status` lists each one.
- **Limit.** At most 32 client connections per daemon on the relay (D10).
- **Dependencies.** `tweetnacl` is removed from the repository; key generation and the session-id
  hash move to `@noble`.
- **Configuration.** `daemon.relay.*` does not change.
- **Identity and pairing link.** Unchanged (D14): `daemon-keypair.json`, the link's `offer` /
  `relay` / `relayTls` fields and `deriveRelaySessionId`. The stored key becomes the daemon's
  static key in the Noise NK handshake.

## Integration points
| Existing module / service / config | How the feature touches it | Direction | Risk / note |
|------------------------------------|----------------------------|-----------|-------------|
| `packages/relay/src/cf-adapter.ts` and its test, exports, README and `AGENTS.md` sections | Removed (D4) | deletes | `swe/architecture/relay-e2ee.md` names Cloudflare as the hosted relay; that line goes too |
| `packages/relay/src/session-bridge.ts`, `relay-server.ts` | Replaced by role-aware pairing: a control socket per daemon, one piped socket pair per client, binary frames forwarded, per-pair flow control (D1, D6) | rewrites | The bridge's "forward to every other socket" model disappears |
| `packages/relay/src/channel.ts` | Replaced by a Noise NK channel on `@noble` primitives; `tweetnacl` is no longer needed for the channel (D5) | rewrites | The daemon keypair generation and `deriveRelaySessionId` also use `tweetnacl` today |
| `packages/server/src/daemon/relay-transport.ts`, `daemon/bootstrap.ts` (relay block) | Control socket plus one data socket per client; one `Session` per data socket, whose socket reports a real `bufferedAmount` (D6) | rewrites | The single `relaySession` variable and "relay peer replaced" path go away |
| `packages/client/src/relay-transport.ts` | Speaks the new relay protocol and Noise NK; surfaces "daemon offline" as a connect failure (D5, D7) | rewrites | `connect()` has no timeout today |
| `packages/server/src/files/file-transfer.ts` (download pacing) | Unchanged; starts working on relay sessions because their socket now reports its queue (D6) | reads | Removes the "relay downloads are unpaced" caveat in `desktop-client-protocol-followups.md` |
| Pi Studio Desktop (Rust, separate repository) | Implements the client side with `snow` (D5) | consumes | Needs a pinned contract to test against without a live relay |
| `packages/protocol/fixtures/external-clients/` | Gains fixed-key fixtures for the Noise NK handshake, encrypted records and the relay's control messages (D11) | writes | First fixtures that are not daemon messages; the fixture README and manifest rules need a place for them |
| `packages/cli/src/pairing.ts`, `packages/client` (`parsePairingUrl`), `$PI_STUDIO_HOME/daemon-keypair.json` | Not changed (D14). The stored key is read as the Noise static key | reads | Tested: same public key and X25519 output from `@noble/curves` as from `tweetnacl` |
| `tweetnacl` (all packages) | Removed (D13) | deletes | Used by the channel, the daemon keypair and `deriveRelaySessionId` |

## Edge cases & failure modes
| Area | Condition | Decided behavior | Decision |
|------|-----------|------------------|----------|
| dependencies | An outdated daemon (old protocol) is connected to the new relay | The relay keeps its socket open and idle; it is never paired. A client asking for that daemon is told the daemon must be updated | D3 |
| dependencies | The daemon is not connected to the relay when a client asks for its session id | The relay refuses the client at once with a "daemon offline" reason | D7 |
| scale | A 33rd client asks for a daemon that already has 32 relay connections | The relay refuses it with a "too many clients" reason | D10 |
| inputs | A frame larger than one Noise record (65 535 bytes) after pairing | The relay closes that connection | D13 |
| data lifecycle | A pairing link or QR code issued before the update | Keeps working once daemon and client are both updated | D14 |
| data lifecycle | Retention, export, deletion | n/a — the relay persists nothing and the daemon adds no stored data | D13 |
| dependencies | A browser tab still running the old web client | The relay leaves it connected and idle; it shows "connecting" until reloaded | D16 |
| dependencies | An updated daemon dials an outdated self-hosted relay | No registration answer within 10 s; the daemon logs that the relay must be updated and retries with backoff | D17 |
| dependencies | The relay restarts | Every socket drops; daemons register again, clients reconnect through their existing reconnect loop | D17 |
| timing | The daemon's control socket closes or the relay is unreachable | The daemon redials with backoff and jitter, from 1 s up to 30 s (today: at once, in a loop) | D17 |
| timing | A socket goes silent without closing | The relay pings every socket every 30 s and closes one that misses two pings. The daemon redials when its control socket has been silent for 90 s | D17 |
| timing | The daemon's control socket drops while clients are connected | Connected clients keep running; new clients get "daemon offline" until the daemon registers again | D15 |
| timing | The daemon does not dial for a new client within 10 s | The relay refuses the client with a "daemon unresponsive" reason | D17 |
| timing | The client leaves before the daemon's socket for it arrives | The relay closes that socket when it arrives | D17 |
| timing | A client's connect attempt gets no result | It fails after 15 s (today: never) | D17 |
| state | A second daemon registers a session id that already has a control socket | The newest replaces the older control socket; existing client connections continue | D17 |
| identity & access | Someone who holds the pairing link registers as the daemon | Possible (previous row). Accepted: a link holder already has full access | D17 |
| identity & access | The daemon's key was replaced (`daemon rotate-key`) and a client uses an old link | The relay answers "daemon offline": it cannot tell a replaced key from an offline daemon. The client's message names both possibilities | D17 |
| identity & access | A record fails decryption (modified, replayed, reordered, reflected), or the handshake fails (wrong daemon key) | That one connection is closed; the client reconnects with new keys | D17 |
| inputs | A socket does not say what it is within 10 s | The relay closes it | D17 |
| scale | The receiver is slower than the sender | The relay stops reading from the sender while more than 1 MiB is queued for the receiver and resumes below 256 KiB (the daemon's own marks) | D17 |
| observability & ops | What the relay records | One structured log line per connection (connection id, session id, time to pair, bytes each way, duration, close reason); no payload, no statistics endpoint | D20 |
| observability & ops | Feature flag off | n/a — there is no flag; the change ships in one release | D21 |
| observability & ops | Rollback after daemons were updated | The previous relay and web-client images are redeployed; updated daemons cannot use the relay until downgraded; direct connections are unaffected | D21 |

## Non-functional constraints
| Concern | Constraint / decision |
|---------|-----------------------|
| Performance / volume | 32 client connections per daemon (D10). Per connection the relay holds at most about 1 MiB queued (D17). Transfers: correctness and bounded memory are the gate; throughput is recorded, not gated (D18) |
| Security & authorization | Trust model unchanged: the relay is untrusted and the pairing link is the only credential (D21, D14). Noise NK adds forward secrecy and makes a modified, replayed, reordered or reflected record fatal to its connection (D2, D5, D17). Relay limits: frame size cap, 10 s to identify, 32 clients per daemon; nothing per address (D19) |
| Privacy | The relay still sees addresses, timing, sizes, session ids and the public handshake keys. It no longer sees whether a message is text or binary. It logs no payload (D21) |
| Backward compatibility | None kept on the wire: hard cut (D3). Old daemons and old browser tabs are left connected and idle (D3, D16). Pairing links and the daemon key are unchanged (D14) |
| Rollout / feature flag | One release carries the relay, daemon, SDK and workbench changes together; no feature flag. The hosted relay and web client switch at that release. Each user must update their daemon and the web client says so. A self-hosted relay is updated together with its daemons (D21) |
| Observability | Structured logs only (D20) |
| Rollback | Redeploy the previous relay and web-client images. Daemons already updated cannot use the relay until they are downgraded. Direct connections are unaffected either way (D21) |

## Deferred
- **A pairing secret separate from the daemon's key** and **per-device credentials** (one named,
  individually revocable credential per pairing). Offered in round 4, not chosen. The daemon's key
  stays the only credential and `daemon rotate-key` the only revocation. Per-device credentials can
  be added later without another wire break, inside the encrypted `hello`.
- **A per-address socket cap on the relay** and **a relay statistics endpoint.** Offered in round
  5, not chosen (D19, D20).
- **A throughput pass mark for relay transfers.** Not set; figures are recorded only (D18).

## Open questions — TODO(verify)
- [x] D2 said "from existing libraries", but no maintained TypeScript Noise library offers NK.
      Resolved in round 2 by D5.
- [x] D9 chose a new identity and link format but not its contents. Withdrawn by D14 in round 4.
- [x] That an existing `daemon-keypair.json` works unchanged as a Noise static key: tested by the
      agent on 2026-11-15 with `tweetnacl` 1.0.3 and `@noble/curves` 2.4.0 (200 random keys: same
      public key, same X25519 output). The scope should keep that as a test.
- [ ] The two-client eviction loop and the reflected-frame decryption are inferred from the code,
      not reproduced — owner: agent (reproduce in a test when the scope is written).
- [ ] The Noise cipher suite name was not put to the engineer. The agent's proposal is
      `Noise_NK_25519_ChaChaPoly_BLAKE2s`: `snow` and `@noble` both support it. That published
      test vectors exist for exactly this suite was not checked — owner: agent, at scope time.
- [ ] Wire details left to the scope: how a socket states its role and session id, the control
      messages between relay and daemon, the record header (text or binary, more-to-follow), the
      close codes behind each refusal reason, and how the relay recognises an old-protocol socket
      — owner: agent, at scope time.
- [ ] Whether the hosted relay sees real client addresses or only its reverse proxy's — owner:
      engineer. Matters only if a per-address limit is added later.
- [x] At the readout after round 5 the engineer first kept the grill open, to check that the
      withdrawal of D9 had been recorded (D14). Confirmed and closed on 2026-11-15.

## Acceptance criteria (draft)
Confirmed by the engineer in round 5 (D22).

- [ ] Given a daemon on the relay, when two clients use it at the same time, then neither
      disconnects the other and `daemon_status` lists two relay sessions.
- [ ] Given 32 connected clients, when one more asks, then it is refused with "too many clients";
      after one leaves, a new one connects.
- [ ] Given a local relay, when a 600 MiB file is downloaded and uploaded through it, then both
      finish with a matching SHA-256; with the receiver paused, relay and daemon memory stay far
      below the file size; a second client keeps getting answers during the transfer.
- [ ] Binary data crosses the relay as binary frames; nothing is base64 inside JSON.
- [ ] The TypeScript Noise NK code passes the published Noise test vectors and completes a
      handshake with `snow`.
- [ ] A modified, replayed, reordered or reflected record closes the connection and delivers
      nothing. A client with the wrong daemon key cannot connect.
- [ ] A message larger than one record (5 MiB of JSON) arrives intact; an oversized frame closes
      the connection.
- [ ] Daemon offline: the client is told so at once. Daemon unresponsive: told after 10 s. No
      connect attempt lasts longer than 15 s.
- [ ] An old-protocol daemon stays connected and idle without a redial storm, and a client asking
      for it is told the daemon must be updated.
- [ ] With the relay down, the daemon's redials are spaced by backoff. A silent control socket is
      replaced within 90 s. Connected clients survive a control-socket drop.
- [ ] A pairing link issued before the update works once both sides are updated.
- [ ] Fixed-key fixtures exist and the TypeScript code is tested against them. `tweetnacl` and the
      Cloudflare adapter are gone, and the relay documents are rewritten.
- [ ] Live check on the compose stack: two browser tabs through the relay at once, with a terminal
      and a file transfer.

## Round log
| Round | Theme | Summary |
|-------|-------|---------|
| 1 | outcome & scope boundary | Parity in (D1), Noise NK (D2), hard cut (D3), Cloudflare adapter deleted (D4). Problem statement taken from recon and the feasibility discussion. After the round the agent checked Noise libraries: D2's "existing libraries" does not hold on the TypeScript side; raised as a blocking question for round 2 |
| 2 | topology & happy path | Noise NK kept on `@noble` primitives with an in-repo NK state machine (D5); one daemon socket per client (D6); "daemon offline" refused at once (D7); seven-step happy path confirmed (D8) |
| 3 | data & integration | New identity and link format, contents pending (D9); cap of 32 clients per daemon (D10); fixed-key fixtures for the Rust client (D11); CLI over relay out (D12); data rules confirmed (D13) |
| 4 | pairing identity & edge cases | D9 withdrawn: key, link and session id unchanged (D14); connected clients survive a control-socket drop (D15); stale tabs left idle (D16); twelve remaining edge-case behaviours confirmed (D17). Separate pairing secret and per-device credentials deferred |
| 5 | constraints & acceptance | Transfers gated on correctness and bounded memory, throughput recorded only (D18); no further abuse limits (D19); logs only (D20); rollout, rollback and privacy rules confirmed (D21); thirteen acceptance criteria confirmed (D22) |
| — | readout | Presented after round 5: 22 decisions (21 in force), 24 edge-case rows, no blocking question. The engineer first kept the grill open to check that D9's withdrawal was recorded, then confirmed: "you can close the grill then". Status `grilled` |

## Handoff to scope
| Spec file to produce | Fed by brief sections |
|----------------------|-----------------------|
| `swe/architecture/relay-e2ee.md` (rewritten: it describes the protocol being replaced) | Happy path; Decisions D2, D5, D6, D10, D13, D14; Data & state; Edge cases & failure modes; Non-functional constraints (security, privacy); Open questions (suite name, wire details) |
| `swe/features/relay-multi-client.md` (new: the change itself) | Problem & outcome; Goals; Non-goals; Decisions D1, D3, D4, D7, D11, D12, D15–D22; Integration points; Non-functional constraints (compatibility, rollout, rollback, observability); Deferred; Acceptance criteria |
| `swe/architecture/external-client-fixtures.md` (amended) | Decision D11; Integration points (fixtures row) |
| `swe/features/connection-resilience.md` (amended) | Decisions D7, D17 (connect limit, refusal reasons, daemon redial backoff, dead-socket detection) |
| `swe/features/desktop-client-protocol-followups.md`, `docs/desktop-client-handoff.md` (amended) | Integration points (download pacing now holds on the relay; a second connection per client is allowed) |
