# Grill — Desktop relay in Rust and SSH entries (milestone 4)

> Status: grilling
> Started: 2026-11-22   Last updated: 2026-11-22   Rounds: 3
> Engineer: avatsaev   Agent: Claude (omp)
> Round 1 was recon plus the agent's proposed decisions. The owner asked not to be asked about
> low-impact points (2026-11-22), so every decision below is the agent's until the owner confirms
> the readout. A decision the owner changes is rewritten here, not appended.

## Raw idea

"let's get ready for milestone 4", where the subject is milestone 4 of
`docs/desktop-client-handoff.md` § Suggested milestones:

> **Relay in Rust, and a connection over SSH.** Implement protocol 2
> (`swe/architecture/relay-protocol.md`) and pass the relay fixtures. Check: a paired remote
> daemon works with the same behaviour as direct. **Added by the owner (2026-11-21): a daemon
> entry of kind SSH**, so a user with an SSH account on the daemon's host needs neither the relay
> nor an open daemon port: Rust opens an SSH connection and runs the daemon connection over a
> `direct-tcpip` channel to the host's `127.0.0.1:6767`. Decided: SSH is built into the app with a
> Rust library (`russh`), not the machine's `ssh` program; the first version logs in with a key
> file (optional passphrase), an SSH agent or a password, and reads `~/.ssh/config`; when the
> daemon is not running on the host, a Start button runs `pi-studio daemon start` there over the
> same SSH connection. Check: a daemon bound to loopback on another machine is used through SSH
> with the same behaviour as direct.

The owner's earlier decisions for SSH are the note at the top of
`swe/architecture/ssh-gateway-connections.md` (2026-11-21); the body of that file is the Electron
plan and is superseded where the note differs.

## Codebase context

Paths under `desktop/` unless they start with `packages/`, `swe/` or `docs/`.

| Area | Path(s) | Fact that matters |
|------|---------|-------------------|
| Relay wire | `swe/architecture/relay-protocol.md`, `packages/relay/src/channel.ts`, `control.ts`, `session-id.ts`, `packages/client/src/relay-transport.ts` | Client: send `relay_client_connect {v:2, sessionId}`, wait for `relay_paired`, then a NaCl-box channel (`0x01‖pub` hello, `0x01‖salt‖box` ready, nonce salt‖direction‖counter, kind byte `0x01` text / `0x02` binary). Whole connect within 15 s. Eight `RelayConnectError` reasons; close codes 4100–4109, 4200 |
| Relay fixtures | `packages/protocol/fixtures/external-clients/relay/` | Own `manifest.json` (`formatVersion` 1): `keys.json`, `control.*`, `close-codes.json`, `channel.*`. Fixed client keys and salt, so a Rust test must inject both. No fixture for the pairing link, the connect state machine or the close-to-reason map |
| Pairing link | `packages/client/src/pairing.ts`, `packages/cli/src/pairing.ts` | `#offer=<b64 key>&relay=<host>&relayTls=0|1`, or `host=` for a direct hint. The TypeScript parser does not check the key length. Session id = hex of the first 16 bytes of SHA-512(daemon key) |
| Crypto | `Cargo.lock`, handoff § relay | `crypto_box` (`SalsaBox`) was checked byte-identical to tweetnacl (2026-11-15). Not in the lock yet; `sha2`, `rand`, `base64` are |
| Desktop relay today | `crates/engine/src/local.rs:187-217`, `src/host/connection.ts:25-29` | A relay entry gives the page its pairing link (`daemon_resolve_current`, the one command that still returns a secret) and the page opens its own WebSocket with the SDK's relay transport. `plan_bridge` answers `not_bridged`; transfers take the page's path |
| Invalid-link mark | `packages/workbench/src/features/daemons/daemon-lifecycle.ts:51-58`, `lib/connection/connect-failure.ts` | Set when the connect error is a `RelayConnectError` with reason `wrong_key`. The proxied transport throws a plain `Error`, so the reason must be carried through `transport_open` |
| Rust socket | `crates/net/src/stream.rs:19-23`, `dial.rs:35-110` | `Stream` is a closed enum (TCP, TLS); `Socket = WebSocketStream<Stream>`; `dial` = TCP, TLS, upgrade, all under a 15 s limit. TCP keepalive is set on the TCP socket only |
| Proxy | `crates/net/src/proxy/run.rs:119-140`, `mod.rs:287-302` | `Task` and `Reservation::open` take the concrete `Socket`; `pump.rs` and `close.rs` are generic over `WebSocketStream<A/B>`. At most 4 connections |
| Transfer engine | `crates/transfer/src/engine/connector.rs:12-32`, `connection.rs:68-124`, `src-tauri/src/transfers/engine.rs:55-100` | `Connector::connect` returns `Socket`; `Connection::open` already takes any `WebSocketStream<S: Transport>`. `FINAL_CODES` decides what is never retried |
| Error codes | `crates/net/src/error.rs` | `ErrorCode` is closed and its strings are read by the page; a test pins the list |
| Registry | `crates/model/src/registry.rs`, `lib.rs:208-219` | `Kind` = local, direct, relay; file version 2. A newer version or an unknown kind makes an older build set the file aside and start empty |
| Secrets | `crates/secrets/src/lib.rs`, `file.rs:121-139` | `SecretKind` = password, pairing link. One unknown key makes an older build set the whole `secrets.json` aside (file backend only; the keychain keeps items per account) |
| Local daemon control | `crates/shell/src/supervisor.rs`, `cli_answers.rs`, `shell_env.rs`, `cli_find.rs` | `cli_answers` (answer parser, version check, `MIN_CLI_VERSION` 0.0.127) is pure and reusable. The supervisor, its state and its queue are local-only and single. The shell crate may not hold a socket |
| Page, kinds | `packages/workbench/src/host/types.ts:23-58`, `features/daemons/daemon-form.ts`, `daemons-screen-view.ts`, `src/host/daemons-view.ts:18`, `src/host/transfers.ts:57` | Every place lists the kinds. An unknown kind makes the desktop host drop the whole registry view |
| Layers | `xtask/src/layers.rs` | `net` L7 (transfer and apps only), `transfer` L8, `shell` L6, `engine` L5. A new crate must be added to the table |
| SSH library | russh 0.65.4 (docs.rs) | MSRV 1.89 (workspace 1.95). Defaults to `aws-lc-rs`, which the workspace avoids (cmake/NASM on Windows): use `default-features = false, features = ["ring", "rsa", "flate2"]`. Pins `ssh-key = 0.7.0-rc.12`. Has agent clients (Unix socket, Windows pipe, Pageant), `direct-tcpip`, exec, keepalive, `check_known_hosts`. No config parsing, no reconnect, no prompt policy |
| SSH config | `ssh2-config` 0.9.0 (MIT) | Host patterns, HostName, User, Port, IdentityFile, ProxyJump, Include. No `Match`, no `%` tokens; `IdentitiesOnly`/`IdentityAgent` only as untyped fields |
| Remote start | `packages/cli/src/commands/daemon-commands.ts:~118-160` | `daemon start` listens on `-H` (default `127.0.0.1:6767`) and ignores `daemon.listen`. `--json` prints one line holding `pairingUrl`, a credential. The daemon detaches, so the exec channel ends when the CLI exits |
| Remote PATH | sshd | An exec channel runs `$SHELL -c` with sshd's PATH; nvm/fnm/volta setups are not on it, and both `node` and `pi-studio` must resolve |
| Live checks | `docs/development.md` (Linux Docker image `pi-desktop-xvfb`, WebKitWebDriver, `ui.inspect`), `apps/pistudiodesktop/scripts/platform-checks/` | A real relay runs from `packages/relay/dist/relay-main.js`; an sshd would be new in the image |

## Problem & outcome

- **Who:** a desktop-app user whose daemon runs on another machine.
- **Today:** a relay entry runs in the page (its own WebSocket, the pairing link handed to the page,
  transfers through the page). There is no SSH entry: a daemon on another machine needs the relay
  or an open daemon port.
- **Done means:** a relay entry and an SSH entry behave like a direct entry: Rust owns the socket,
  the page reaches it through the loopback proxy, transfers run in the engine, and the connection
  comes back after a drop or a sleep.
- **Measured by:** a Linux check with a real relay and a real sshd, each against a daemon that
  listens only on loopback (D19, D20).

## Goals

- A relay entry connects in Rust (protocol 2) and passes the relay fixtures (D1–D4).
- The pairing link never reaches the page (D5).
- A new SSH entry kind connects over `direct-tcpip` with a key file, an agent or a password, and
  reads `~/.ssh/config`, including a jump host (D8–D13).
- An SSH entry whose daemon is not running offers Start, which runs `pi-studio daemon start` on the
  host (D14).
- Transfers run in the engine for relay and SSH entries (D6).

## Non-goals

- The browser client's relay transport (TypeScript) is unchanged.
- No `ProxyCommand`, no `Match` blocks, no `%` tokens in `~/.ssh/config` (D10).
- No Stop or Restart for an SSH entry's daemon; only Start, as the owner specified (D14).
- No remote Windows host: the daemon runs on macOS, Linux or WSL.
- No checks on macOS or Windows (owner's decision of 2026-11-22 carried over).
- No change to the relay server, the daemon or the wire protocol.

## Happy path

Relay entry:
1. The user pastes a pairing link in the Daemons screen (as today).
2. Choosing the entry: Rust reads the link from the secret store, dials the relay, pairs, runs the
   key exchange and hands the encrypted channel to the loopback proxy.
3. The page connects to the proxy and sends its `hello`; Rust encrypts and decrypts every message.
4. An upload or save opens a second relay channel for the engine.

SSH entry:
1. The user adds an entry: a host (an alias from `~/.ssh/config` or a host name), optional user,
   port, key file, jump host, password or passphrase, and the daemon's port on the host (6767).
2. Choosing it: Rust resolves the host through `~/.ssh/config`, connects (through the jump host if
   any), checks the host key, logs in, and opens `direct-tcpip` to `127.0.0.1:<daemon port>`.
3. First connection to that host: a native dialog shows the key's fingerprint; Trust stores it.
4. The daemon is not running: the entry's state says so and offers Start; Start runs the CLI over
   SSH, waits for its answer, then connects.
5. Transfers open a second `direct-tcpip` channel on the same SSH connection.

## Decisions

All agent-proposed in round 1, pending the owner's readout.

| # | Theme | Question | Decision | Rationale | Round |
|---|-------|----------|----------|-----------|-------|
| D1 | scope | Where the relay client lives | A new crate at the `net` layer, holding the link parser, the session id, the channel (crypto, counters, framing) and the connect state machine. The pure parts (link, session id, channel) have no socket and are tested against the fixtures | Keeps sockets in the socket layer and the crypto testable alone | 1 |
| D2 | integration | How a relay channel meets the proxy and the engine, which take a byte-stream WebSocket | Widen the proxy task, `Reservation::open` and `Connector::connect` to a daemon socket that is either a WebSocket over a byte stream (TCP, TLS, SSH channel) or a relay channel, both exposed as a stream and sink of WebSocket messages. No in-memory re-framing | A relay channel carries messages, not bytes; re-framing would copy every message twice | 1 |
| D3 | data | Crypto crate | `crypto_box` (`SalsaBox`), checked in a test against `keys.json`'s `sharedKey` and the channel fixtures; licences checked against rule 9 and listed in `ATTRIBUTION.md` | Already checked byte-identical to tweetnacl; RustCrypto, MIT/Apache | 1 |
| D4 | integration | Relay failure reasons in the page | `transport_open` answers the relay reason as its code; the desktop host rethrows it as the SDK's `RelayConnectError`, so the wrong-key mark, the Replace link action and the messages work unchanged | The workbench keys off `RelayConnectError.reason` | 1 |
| D5 | security | The pairing link and the page | No command returns the link any more. The page's relay path in the desktop host is removed (no fallback, no-compat rule), and `secret_guard` asserts no command returns it | The link is the credential; the exception existed only until Rust owned the relay | 1 |
| D6 | scope | Transfers for relay and SSH entries | The engine's connector dials them like the page's connection (a second relay channel; a second `direct-tcpip` channel). `--transfers page` keeps forcing the page's path | Same behaviour as direct | 1 |
| D7 | edge | A link with `host=` and no relay | Rust dials it as a plain direct WebSocket, as the SDK does | Same result as today, without the page's socket | 1 |
| D8 | data | SSH entry fields | `host` (alias or name), `user?`, `port?`, `identityFile?`, `jump?`, `daemonPort` (default 6767), and flags for three secrets: SSH password, key passphrase, daemon password. Form values override `~/.ssh/config` | What `ssh` takes on its command line | 1 |
| D9 | data | When `~/.ssh/config` is read | At every connect, not copied into the entry | An edit to the config applies, as with `ssh` | 1 |
| D10 | scope | Config support | Via `ssh2-config`: Host patterns, HostName, User, Port, IdentityFile, IdentitiesOnly, ProxyJump (hops in order), Include. `ProxyCommand` is refused with a message; `Match` and tokens are ignored. A config that does not parse fails the connect with its line | `ProxyCommand` needs an outside process, which the owner excluded | 1 |
| D11 | auth | Login order | As OpenSSH: agent identities (unless IdentitiesOnly), then key files (entry, then config, then the default `~/.ssh/id_*`), then the stored password. Stop after the server's refusal limit | Matches what users expect from `ssh` | 1 |
| D12 | auth | Secrets entered when | In the Daemons form, stored in the secret store, never asked at connect. A key that needs a passphrase that is not stored fails with `passphrase_needed` and a pointer to the form | A native dialog cannot take text, and a page prompt is a new round trip for a rare case | 1 |
| D13 | security | Host keys | Trusted if listed in `~/.ssh/known_hosts` or the app's own `known_hosts` (OpenSSH format, in the app's config directory). Unknown key: a native dialog with the key type and SHA-256 fingerprint; Trust appends it to the app's file. Changed key: refused with `host_key_changed`, no override in the app | OpenSSH's default; the owner chose the app's own file for writes | 1 |
| D14 | scope | Remote Start | Start runs `pi-studio --json daemon start -H 127.0.0.1:<daemonPort>` over an exec channel, through the login shell (`$SHELL -lc`) between markers, after `pi-studio --version` ≥ `MIN_CLI_VERSION`. The answer goes through `cli_answers`; its output is never logged. 90 s limit, as local | sshd's PATH misses nvm-style installs; `-H` keeps the port the entry dials | 1 |
| D15 | lifetime | SSH connection lifetime | One SSH connection per current SSH entry, carrying the page's channel and the engine's. It closes when neither is open for 30 s. SSH keepalive every 15 s, dead after 3 missed. A dead connection is redialled on the next open | The page's reconnect and the engine's backoff already drive reopening | 1 |
| D16 | timing | Connect limit | The 15 s dial limit covers each network step; the host-key dialog is outside it | A person reading a fingerprint is not a timeout | 1 |
| D17 | data | Registry and secrets on disk | Registry file version 3 with kind `ssh`; new secret kinds. An older app sets the files aside (no-compat rule) | Owner rule of 2026-11-22 | 1 |
| D18 | agent | Agent socket for an app opened from the dock | `SSH_AUTH_SOCK` comes from the login-shell environment the app already reads (`shell_env.rs`). Windows: the OpenSSH pipe, then Pageant | A dock launch does not inherit the shell's agent | 1 |
| D19 | acceptance | "Same behaviour as direct" for transfers | Correct bytes and bounded memory, measured and recorded; no speed mark | `relay-multi-client.md` D18 already set this for the relay | 1 |
| D20 | acceptance | Where it is checked | Linux, in the Docker image, with a real relay from the repo and an sshd in the image, each in front of a daemon on loopback | Owner: no manual testing, no macOS/Windows checks | 1 |
| D21 | scope | Shape of the remote command runner | One general piece: run a command on the host over the SSH connection, with a time limit and its output captured and never logged. Start is its first user | **Owner accepted, 2026-11-22.** The later installer (milestone 6) reuses it | 3 |
| D22 | scope | `pi-studio` missing on the host | Its own state on the entry's row, `not_installed`, apart from `cli_outdated` and "not running". The row shows the install command with a copy button. The same place takes an Install button later | **Owner accepted, 2026-11-22.** | 3 |
| D23 | scope | Adding an SSH entry | The Add form lists the hosts of `~/.ssh/config` (the `Host` names without wildcards); choosing one fills the form. Typing a host by hand stays possible | **Owner accepted, 2026-11-22**: first use is a priority | 3 |

## Data & state

- `daemons.json` version 3: an `ssh` entry holds `host`, `user?`, `port?`, `identityFile?`,
  `jump?`, `daemonPort`, `hasPassword` (daemon), `hasSshPassword`, `hasPassphrase`. The view shown
  to the page and the native menu gives `user@host:port` as the address.
- Secret kinds added: SSH password, key passphrase. Removing the entry removes all three.
- `known_hosts` in the app's config directory, OpenSSH format, append-only from the app.
- Per-entry remote state for the current SSH entry (running, not running, not installed, CLI
  outdated, starting, failed), in memory only.
- Relay: nothing new on disk.

## Integration points

| Existing module / service / config | How the feature touches it | Direction | Risk / note |
|------------------------------------|----------------------------|-----------|-------------|
| `crates/net` (stream, dial, proxy, error codes) | Daemon socket widened (D2); dial over a supplied stream; new codes | changes | Codes are page-visible and pinned by a test |
| `crates/transfer` (connector, `FINAL_CODES`) | Connector returns the widened socket; new codes classed | changes | Retry: offline, unreachable, unresponsive; final: wrong key, outdated, auth, host key |
| New relay crate, new SSH module or crate | Protocol 2 client; russh client | new | Layer table and its tests |
| `crates/model`, `crates/secrets`, `crates/engine` | Kind `ssh`, version 3, secret kinds, dial plan per kind | changes | No-compat downgrade |
| `crates/shell` | Remote start through a hook the app fills | changes | Shell may not hold a socket |
| `src-tauri` (transport, transfers connector, commands) | Branch per kind; the native host-key dialog | changes | One native dialog at a time |
| `packages/workbench` (types, Daemons form, screen, switcher) | Kind `ssh` in the form and views; Start on an SSH row | changes | Shared with the browser client, which shows no SSH form |
| Desktop host (`connection.ts`, `transfers.ts`, `daemons-view.ts`) | All kinds proxied; relay path removed; reason rethrown | changes | |
| CSP `connect-src` | `ws:`/`wss:` kept only for the loopback proxy | narrows | |
| Docs | handoff, `desktop/AGENTS.md`, `docs/architecture.md`, registry and bridge specs, `ssh-gateway-connections.md` | updates | |

## Edge cases & failure modes

| Area | Condition | Decided behavior | Decision |
|------|-----------|------------------|----------|
| inputs | Link without `offer`, key not 32 bytes, bad base64, both `host` and `relay` | Refused at entry with `invalid_link` | D1 |
| inputs | `~/.ssh/config` missing, malformed, or with `ProxyCommand` | Missing: ignored. Malformed: connect fails naming the line. `ProxyCommand`: refused | D10 |
| inputs | Key in a format russh cannot read (legacy PEM with DES, PPK) | `key_unreadable` with the path | D11 |
| identity | Relay key rotated | `daemon_offline`, as the SDK reports it | D4 |
| identity | Wrong pairing link | `wrong_key`; the entry is marked and offers Replace link | D4 |
| identity | SSH login refused | `auth_failed`, final, never retried | D11 |
| identity | Host key unknown / changed | Dialog / refused | D13 |
| identity | Daemon behind SSH has a password | The entry's daemon password is sent in the upgrade, as direct | D8 |
| state | Daemon not running on the SSH host | `direct-tcpip` refused gives `daemon_not_running`; the row offers Start | D14 |
| state | Remote CLI missing or older than 0.0.127 | `cli_missing` / `cli_outdated` on the row | D14 |
| state | `AllowTcpForwarding no` or `PermitOpen` refusal | `forwarding_refused` | D15 |
| state | Forwarding-only account (`ForceCommand`) | Connects; Start fails with the command's error | D14 |
| timing | Sleep or network change | Existing signals; SSH keepalive and the page's ping find the dead connection; reopening redials | D15 |
| timing | Relay counter near 2^64 | Close before wrap | D1 |
| scale | Two connections per window through the relay | Counted against the daemon's 32 | D6 |
| scale | Large transfer over SSH | Window and packet size set for throughput; measured | D19 |
| dependencies | Relay down / outdated relay | `relay_unreachable` / `timeout` | D4 |
| dependencies | Agent with no identities, locked, or absent | Skipped; next method | D11 |
| data lifecycle | An older app opens the new files | Sets them aside (no-compat) | D17 |
| observability | Logs | Never the link, the relay host, secrets, exec output, or fingerprints with user names; codes only | D5, D14 |

## Non-functional constraints

| Concern | Constraint / decision |
|---------|-----------------------|
| Performance / volume | Bounded memory per connection, as milestone 3; speed recorded, not gated (D19) |
| Security & authorization | No secret reaches the page; host keys checked (D13); exec output not logged (D14) |
| Privacy | Links, hosts, user names out of logs |
| Backward compatibility | None (owner, 2026-11-22): registry v3, page relay path removed |
| Rollout / feature flag | None |
| Observability | `ui.inspect` reports the connection kind and the last error code |
| Rollback | Older app sets the new files aside |

## Deferred

- Stop and Restart for an SSH entry's daemon (owner specified Start only).
- A runtime prompt for a missing passphrase or password (D12).
- `ProxyCommand`, `Match`, `%` tokens (D10).
- Checks on macOS and Windows, including the Windows agent (D20).
- **Owner, 2026-11-22, for a later milestone:** install and set up the daemon on the host through
  the SSH connection, and register it as a service that starts with the machine where that is
  possible, to make first use easy. First-use experience is a high priority for the owner. Not
  part of milestone 4. **Owner, 2026-11-22: it waits for milestone 6** (the single-file daemon),
  because today the host needs Node 22 and npm. Milestone 4 leaves room through D21 and D22.
- Ideas for first use the agent offered and the owner did not take up for milestone 4: a Test
  connection button with a result per step; a first-run screen with three choices (this machine,
  SSH, pairing link); a prompt to sign in to a model provider after the first connection.

## Open questions — TODO(verify)

- [ ] russh with `ring` builds on the macOS universal and Windows CI runners, and its dependency
  licences pass rule 9 — owner: agent, first sprint.
- [ ] `check_known_hosts` handles hashed entries and `[host]:port` in `~/.ssh/known_hosts` — owner:
  agent, first SSH sprint.

## Acceptance criteria (draft)

- [ ] A Rust test rebuilds every relay fixture from `keys.json` and opens every `hex`; an unlisted
  or missing fixture fails it.
- [ ] In the real webview: a relay entry connects through a local relay to a daemon, chat and a
  terminal work, and the page never receives the link.
- [ ] A wrong link marks the entry and offers Replace link; an offline daemon shows its message.
- [ ] A 1 GiB upload and save through the relay and through SSH match their hashes with the
  app's memory bounded.
- [ ] An SSH entry connects to a loopback-only daemon in the image with a key file, an encrypted
  key, the agent, a password, and through a jump host.
- [ ] An unknown host key shows the dialog; a changed key is refused.
- [ ] With the daemon stopped, Start brings it up and the entry connects.
- [ ] On a host without `pi-studio`, the row says it is not installed and shows the install
  command with a copy button.
- [ ] The Add form lists the hosts of `~/.ssh/config`; choosing one and saving gives a working entry.
- [ ] After `kill -STOP`/`-CONT` of the app and after a network change, relay and SSH entries
  reconnect without a reload.

## Round log

| Round | Theme | Summary |
|-------|-------|---------|
| 1 | recon + all themes | Three read-only recons (relay wire, desktop transport, SSH). The agent proposed D1–D20 for the owner's readout |
| 2 | scope (owner's question) | The owner asked whether a later automatic install and boot service over SSH must be accounted for now. The agent answered no, with two small choices to leave room |
| 3 | scope | The owner accepted: the install waits for milestone 6; the general command runner (D21); the not-installed state with the install command (D22); the host list from `~/.ssh/config` (D23) |

## Handoff to scope

(Written when the owner confirms.)
