# Feature — Desktop Relay in Rust and SSH Entries

> **Status: built and checked on Linux 2026-11-22 (sprints 124–130, 27 tasks).** Milestone 4 of the desktop client. macOS and Windows were built by the release workflow (a manual run, nothing published) and not run (owner's decision). Open items are in § TODO(verify).
> Decisions D1–D23 are from the grill ([../grills/desktop-relay-ssh.md](../grills/desktop-relay-ssh.md),
> closed by the owner on 2026-11-22: D21–D23 are the owner's own, D1–D20 were proposed by the agent
> and confirmed with the readout). S1–S16 are proposed in this document; where one refines a D
> decision the table says so. **Compatibility is not a concern** (owner, 2026-11-22): nothing here
> keeps an older path alive.

> Part of: [../MAIN-SCOPE.md](../MAIN-SCOPE.md)
> Dependencies: [../architecture/relay-protocol.md](../architecture/relay-protocol.md) (the wire the
> relay client implements, unchanged), [../architecture/ssh-gateway-connections.md](../architecture/ssh-gateway-connections.md)
> (its note of 2026-11-21 is the owner's record for SSH; its body is superseded by this document),
> [desktop-transport-bridge.md](desktop-transport-bridge.md) (`transport_open`, the proxy, the
> secret store, `ui.inspect`; amended here), [desktop-daemon-registry.md](desktop-daemon-registry.md)
> (the registry file, the commands, `HostDaemons`, the Daemons screen; amended here),
> [desktop-transfer-engine.md](desktop-transfer-engine.md) (the connector; amended here),
> [../architecture/workbench-host-adapter.md](../architecture/workbench-host-adapter.md)
> Desktop rules: `desktop/AGENTS.md`, `desktop/docs/architecture.md`

## Purpose

A desktop-app user whose daemon runs on another machine has two ways to reach it after this
milestone, and both behave like a direct entry: Rust owns the socket, the page reaches it through
the loopback proxy, transfers run in the engine, and the connection comes back after a drop or a
sleep.

- **Relay.** Today a relay entry runs in the page: the page is handed the pairing link, opens its
  own WebSocket and encrypts with the SDK. This milestone moves relay protocol 2 into Rust. The
  pairing link no longer reaches the page.
- **SSH.** A new entry kind. Rust opens an SSH connection to the daemon's host and runs the daemon
  connection over a `direct-tcpip` channel to the host's `127.0.0.1`, so the user needs neither
  the relay nor an open daemon port. When the daemon is not running, a Start button runs
  `pi-studio daemon start` on the host.

Not in it: the browser client's relay transport, the relay server, the daemon and the wire
protocol are unchanged. No `ProxyCommand`, no `Match` blocks. No Stop or Restart for an SSH
entry's daemon. No remote Windows host. No install of the daemon over SSH (the owner deferred it to
milestone 6, 2026-11-22; D21 and D22 leave room for it). No checks on macOS or Windows.

## Decisions

### From the grill

| # | Decision |
|---|---|
| D1 | The relay client is a new crate; its pure parts (link, session id, channel) are tested against the fixtures. Refined by S1 |
| D2 | The proxy and the engine take a daemon socket that is a stream and sink of WebSocket messages, whatever carries them. No in-memory re-framing |
| D3 | `crypto_box` (`SalsaBox`), checked against `keys.json` and the channel fixtures |
| D4 | `transport_open` answers a relay reason as its code; the desktop host rethrows it as the SDK's `RelayConnectError` |
| D5 | No command returns the pairing link. The page's relay path in the desktop host is removed |
| D6 | Transfers for relay and SSH entries run in the engine. `--transfers page` still forces the page's path |
| D7 | A link with `host=` and no relay is dialled by Rust as a plain direct WebSocket |
| D8 | SSH entry fields: `host`, `user?`, `port?`, `identityFile?`, `jump?`, `daemonPort`, and three secrets (SSH password, key passphrase, daemon password). Form values win over `~/.ssh/config` |
| D9 | `~/.ssh/config` is read at every connect, never copied into the entry |
| D10 | Config support through `ssh2-config`: Host patterns, HostName, User, Port, IdentityFile, IdentitiesOnly, ProxyJump, Include. `ProxyCommand` is refused; `Match` and `%` tokens are ignored |
| D11 | Login order as OpenSSH: agent identities (unless IdentitiesOnly), key files (entry, config, defaults), the stored password |
| D12 | Secrets are entered in the Daemons form and stored. Nothing is asked at connect |
| D13 | Host keys: trusted when in `~/.ssh/known_hosts` or the app's own file; an unknown key is shown in a native dialog; a changed key is refused. Timing refined by S6 |
| D14 | Start runs `pi-studio --json daemon start` on the host after a version check, and its output is never logged. The shell invocation is refined by S7 |
| D15 | One SSH connection per current SSH entry, shared by the page's channel and the engine's; closed 30 s after the last channel; keepalive every 15 s, dead after 3 missed |
| D16 | 15 s per network step; a person reading a dialog is not timed |
| D17 | Registry version 3 and new secret kinds; an older app sets the files aside |
| D18 | The agent socket comes from the login-shell environment the app already reads. Windows: the OpenSSH pipe, then Pageant |
| D19 | Transfers over relay and SSH pass on correct bytes and bounded memory. Speed is recorded, not gated |
| D20 | Checked on Linux in the Docker image with a real relay and a real sshd |
| D21 | **Owner.** The remote command runner is one general piece; Start is its first user |
| D22 | **Owner.** `pi-studio` missing on the host is its own state, shown with the install command and a copy button |
| D23 | **Owner.** The Add form lists the hosts of `~/.ssh/config` |

### Proposed here

| # | Decision | Why |
|---|---|---|
| S1 | Two new crates, `pistudiodesktop-relay` and `pistudiodesktop-ssh`, at layer 8 beside `transfer`: each depends on `net` only. The pairing-link parser is in `model` (a data rule, like the address rule), so `daemon.add` can refuse a bad link. Refines D1 | `net` must not know the relay or SSH; the engine must be able to check a link |
| S2 | `net` defines `DaemonSocket`: a boxed stream and sink of WebSocket messages with a message limit. The proxy, `Reservation::open` and `Connector::connect` take it. A WebSocket over TCP, TLS or an SSH channel is one; a relay channel is another | D2 |
| S3 | `daemon_resolve_current` answers, for a relay entry, the relay's WebSocket address (`ws(s)://<relay host>`, or `ws://<host>` for a link with a host hint) and, for an SSH entry, `ws://127.0.0.1:<daemonPort>`. Neither holds a secret: the credential of a link is the daemon's key | The page needs a URL to start a connection; `transport_open` keeps its one input and its address check |
| S4 | Over a relay a message whose sealed size is above 100 MiB closes both legs with 1009 | The relay's frame limit |
| S5 | While dialling the relay, a dial failure of `net` other than `timeout` is `relay_unreachable` | The SDK's reasons |
| S6 | An unknown host key fails the connect at once with `host_key_unknown`. Rust then asks in a native dialog, outside any connect; Trust stores the key and emits `connection_resume`, so the page connects again. One question per host key per page load. Refines D13 and D16 | A connect never waits for a person, so no timer of the SDK or the engine can expire under a dialog |
| S7 | A remote command runs in the user's login shell, interactive, between two random marker lines: `"$SHELL" -lic '…'`. Refines D14's `-lc` | On Debian and Ubuntu `.bashrc` returns early for a non-interactive shell, so nvm is not on the PATH. The local CLI search does the same (`shell/src/shell_env.rs`) |
| S8 | An SSH entry's daemon is never started without the button. The Daemons screen opens by itself when the current SSH entry's state becomes `stopped`, `not_installed`, `cli_outdated` or `failed` | The owner specified a Start button; the local entry's rule (registry D18) for the rest |
| S9 | Opening an SSH connection is limited to 15 s per step and 45 s in all; a channel on an open connection, with the upgrade, to 15 s | A jump host doubles the steps |
| S10 | A version 2 `daemons.json` is read and rewritten as version 3 | The user's entries survive the update. The other direction is D17 |
| S11 | Concurrent opens for one entry share one SSH connection attempt | The page and the engine may ask at the same moment |
| S12 | A new page command lists the hosts of `~/.ssh/config`. Choosing one stores only its alias: the user, port, key and jump host keep coming from the config (D9) | D23 without copying the config |
| S13 | The stored SSH password is offered to the final host only. A jump host is logged in to with the agent or key files | A password meant for one host is not sent to another |
| S14 | The page's `connect-src` allows `ws://127.0.0.1:*` and no other WebSocket address | No socket of the page leaves the machine any more |
| S15 | The app reads `~/.ssh/known_hosts` and never writes it | D13: the app's own file takes the writes |
| S16 | The crates' tests use an in-process SSH server (russh's server half) and an in-process relay stand-in, so `cargo xtask ci` covers both without Docker | The real sshd and relay are for the live check (D20) |

## Public contract

### 1. Registry file, version 3

`daemons.json` gains the kind `ssh`. A version 2 file is read and rewritten as version 3 (S10); a
version above 3 is refused like any unknown version.

```
{ id: uuid, kind: "ssh", name: string,
  host: string, user?: string, port?: number, identityFile?: string, jump?: string,
  daemonPort: number,
  hasPassword?: boolean, hasSshPassword?: boolean, hasPassphrase?: boolean }
```

| Field | Rule |
|---|---|
| `host` | 1–255 characters, no whitespace. An alias of `~/.ssh/config` or a host name or address |
| `user` | At most 64 characters. Absent: the config's `User`, else the local user name |
| `port` | 1–65535. Absent: the config's `Port`, else 22 |
| `identityFile` | At most 4,096 characters; `~` is this machine's home. The path is stored, never the key |
| `jump` | At most 1,024 characters: `[user@]host[:port]`, several separated by commas, in order. Absent: the config's `ProxyJump` |
| `daemonPort` | 1–65535, default 6767: the daemon's port on the host's `127.0.0.1` |
| `hasPassword` | The daemon's password, as for a direct entry |
| `hasSshPassword`, `hasPassphrase` | The SSH account's password; the passphrase of `identityFile` |

Secret store kinds added: `sshPassword` and `sshPassphrase` (each at most 1,024 characters), keyed
as the others by entry id. Removing the entry removes its three secrets.

`EntryView` for an SSH entry: `{ id, kind: "ssh", name, address, hasPassword, ssh }`, where
`address` is the display text `[user@]host[:port]` built by Rust and `ssh` is
`{ host, user?, port?, identityFile?, jump?, daemonPort, hasSshPassword, hasPassphrase }`.

A new file, `known_hosts`, in the app's configuration directory: OpenSSH format, mode 0600,
appended to by the app only.

### 2. Engine commands

| Command | Change |
|---|---|
| `daemon.add` | Also `{ kind: "ssh", name, host, user?, port?, identityFile?, jump?, daemonPort?, password?, sshPassword?, passphrase? }`. A relay entry's `pairingLink` must now parse (§ 4): `invalid_link` otherwise |
| `daemon.update` | Also `host?`, `user?`, `port?`, `identityFile?`, `jump?`, `daemonPort?`, `sshPassword?`, `passphrase?`. `null` clears an optional field or a secret. `wrong_kind` for a field the kind does not have |
| `daemon.list` | Also `remote: RemoteState \| null`: the state of the current entry's daemon when that entry is `ssh` |
| `daemon.remote.start` (new) | No params. Starts the current SSH entry's daemon. `{ accepted: true }`; the outcome arrives as a `RemoteState` change. Errors: `wrong_kind` (the current entry is not `ssh`), `no_current`, `busy`, `not_installed`, `cli_outdated` |
| `daemon.remote.refresh` (new) | No params. Probes again. Errors: `wrong_kind`, `busy` |

New error codes of `daemon.add` and `daemon.update`: `invalid_host`, `invalid_user`, `invalid_port`,
`invalid_path`, `invalid_jump`.

`RemoteState` (in memory; reset when another entry is opened):

| State | Meaning |
|---|---|
| `unknown` | Nothing was learned since the entry was opened |
| `checking` | A probe is running |
| `running` | A connection through SSH reached the daemon, or the CLI reported it up |
| `stopped` | The host refused the channel to `127.0.0.1:<daemonPort>` and the CLI is present and recent enough |
| `not_installed` | The host's login shell does not find `pi-studio` |
| `cli_outdated` | Carries `version`: below `MIN_CLI_VERSION` (0.0.127) |
| `starting` | Start is running |
| `failed` | Carries `reason`: `not_healthy`, `timeout`, `bad_output` (as the local daemon's), `exec_failed` (the command could not be run, the connection was lost, or the begin marker came with no end marker or valid status), `no_shell` (the account refused to run a command, or the shell printed no begin marker) |

### 3. The page's commands

| Command | Input | Answer | Change |
|---|---|---|---|
| `daemon_resolve_current` | none | `{ url, connect: true }` | For a relay or SSH entry `url` is the address of S3. The pairing link is never answered (D5) |
| `transport_open` | `{ url }` | `{ localUrl }` | Works for every kind. `not_bridged` no longer exists. New codes: § Error handling |
| `ssh_config_hosts` (new) | none | `{ hosts: [{ alias, hostName?, user?, port?, identityFile?, jump? }] }` | The `Host` names of `~/.ssh/config` and its includes that have no wildcard, in file order, at most 256. An absent file gives an empty list; a file that does not parse rejects with `ssh_config` |
| `engine_command` | | | Also allows `daemon.remote.start` and `daemon.remote.refresh` |

Event `daemons_changed` carries `remote` with the rest of the registry view.

### 4. The pairing link (in `model`)

```
parse(link) -> { daemonKey: 32 bytes, target: Relay { host, tls } | Direct { host } }
```

The text after `#` is read as form-encoded parameters, as the SDK's parser reads it
(`packages/client/src/pairing.ts`). `offer` is the daemon's public key in standard base64 with or
without padding and must decode to exactly 32 bytes (the SDK does not check the length; Rust
does). `relay` loses a leading `http(s)://` or `ws(s)://` and trailing slashes; `relayTls=1` means
`wss`. A link has `relay` or `host`, not both and not neither. Anything else is `invalid_link`. One
file of test vectors is read by the TypeScript test and the Rust test, as for the address rule.

### 5. The relay client (crate `pistudiodesktop-relay`)

The client side of [relay-protocol.md](../architecture/relay-protocol.md), nothing added:

```
connect(url, daemon key, message limit, time limit), within 15 s in all:       # built with plain parameters; the app parses the link first
    session id = lowercase hex of the first 16 bytes of SHA-512(daemon key)
    dial the relay address with net::dial            # no password, no subprotocol
    send text  {"type":"relay_client_connect","v":2,"sessionId":…}
    wait for relay_paired       # relay_registered is ignored; any other frame is protocol_error
    generate a key pair for this connection only
    shared = box.before(daemon key, my secret key)
    send binary 0x01 ‖ my public key
    wait for    0x01 ‖ salt(15) ‖ box;  open it with nonce(salt, 0x02, 0);  it must be [0x00]
        otherwise: close 4200; fail wrong_key
    answer a DaemonSocket
```

As a `DaemonSocket` (§ 6): a text or binary message is sealed as `kind ‖ payload` (`0x01` text,
`0x02` binary) under nonce `salt ‖ direction ‖ counter` and written as one binary frame; a received
frame is opened with the next counter and delivered by its kind. A frame that does not open, is
shorter than 17 bytes, has an empty or unknown record, or is a text frame, closes with 4200 and
delivers nothing. The connection is closed before a counter would pass 2^64 − 1. The relay's pings
are answered by the WebSocket library. A link of kind `Direct` is not this crate's: the app dials
it with `net::dial` (D7).

### 6. `net`: the daemon socket

```
DaemonSocket: Stream<Item = Result<Message, SocketError>> + Sink<Message> + Send
              max_message_bytes() -> usize

dial(url, password, limit, max message)            -> DaemonSocket     # as today
dial_over(stream, url, password, limit, max message) -> DaemonSocket   # the upgrade on a stream
                                                                       # the caller opened
```

`dial_over` builds the same request as `dial` (the `Host` header from `url`, the bearer
subprotocol) on any `AsyncRead + AsyncWrite` stream. The proxy's pump, its close table and its
limits apply to every `DaemonSocket` unchanged: one message passes as one message, in order;
Rust holds a write batch and one message per direction; a leg that is not read slows the other.
The proxy still allows 4 connections and refuses a socket whose limit is above 128 MiB.

### 7. The SSH client (crate `pistudiodesktop-ssh`)

Built on `russh` with `default-features = false` and the features `ring`, `rsa` and `flate2` (the
workspace does not build `aws-lc`), and `ssh2-config` for the config.

```
resolve(entry, ~/.ssh/config) -> Target { host name, port, user, identity files, identities only,
                                          agent socket, hops: [Target] }
connect(target, secrets, known hosts) -> Session
Session.open_daemon(port, password?, message limit) -> DaemonSocket           (direct-tcpip, then dial_over)
Session.run(command, limit) -> { status, stdout }                             (D21)
Session.close()
```

| Step | Rule |
|---|---|
| Resolve | The entry's `host` is looked up in the config; `HostName`, `User`, `Port`, `IdentityFile`, `IdentitiesOnly`, `IdentityAgent` and `ProxyJump` apply; the entry's own fields win. An absent config is empty. A config that does not parse, or a `ProxyCommand` for the host, fails with `ssh_config` and the line. Each hop is resolved the same way |
| Hops | In order. The connection to hop n+1 runs over a `direct-tcpip` channel of hop n. At most 4 hops |
| Host key | Each host's key is looked up, by host name and port, in `~/.ssh/known_hosts` and the app's file. Found and equal: go on. Found and different: `host_key_changed`. Not found: `host_key_unknown` (S6) |
| Login | Agent identities, unless `IdentitiesOnly`; then the entry's `identityFile`, the config's, then `~/.ssh/id_ed25519`, `id_ecdsa`, `id_rsa`; then the stored password (final host only, S13). An encrypted key is opened with the stored passphrase; with none stored, that key gives `passphrase_needed` if nothing else logs in. At most 6 attempts per host |
| Agent | `IdentityAgent`, else `SSH_AUTH_SOCK` from the login-shell environment (D18). Windows: `\\.\pipe\openssh-ssh-agent`, then Pageant. No agent, or an agent with no identity: skipped |
| Keepalive | Every 15 s; three unanswered close the connection (D15) |
| MACs | russh's SHA-2 MACs in its order, then `hmac-sha1-etm@openssh.com` and `hmac-sha1` last. The server takes the first it also offers, so SHA-1 is used only with a host that offers nothing else; the AEAD ciphers use no MAC at all |
| `run` | One exec channel. `stdout` is kept up to 64 KiB, `stderr` is dropped, neither is logged. Killed at `limit` |

The app holds at most one `Session` (with its hops): the current SSH entry's. It is opened by the
first `transport_open` or engine connect and shared (S11); it is closed 30 s after its last
channel closed, on `daemon_switch`, and when a keepalive fails. The next open redials.

### 8. Remote commands and Start

Each command is sent as `"$SHELL" -lic '<begin marker>; <command>; <end marker with the status>'`
and the answer is what lies between the markers (S7).

| Purpose | Command | Limit | Result |
|---|---|---|---|
| Version | `pi-studio --version` | 15 s | Not found: `not_installed`. Below 0.0.127: `cli_outdated`. A shell that prints no marker: `failed/no_shell` |
| Start | `pi-studio --json -H 127.0.0.1:<daemonPort> daemon start` | 90 s | The last non-empty line, read by `cli_answers` whatever the exit status: `up` gives `running`; otherwise `failed` with the CLI's reason. `pairingUrl` is discarded |

`-H` is given because `daemon start` listens where `-H` says and does not read `daemon.listen`. A
probe is the version command; it runs after a `transport_open` that failed with
`daemon_not_running`, and on `daemon.remote.refresh`. After a successful Start Rust emits
`connection_resume`.

### 9. Host members

`HostDaemons` (in `packages/workbench/src/host/types.ts`):

```ts
kind: "local" | "direct" | "relay" | "ssh"                 // DaemonEntryView
ssh?: { host: string; user?: string; port?: number; identityFile?: string; jump?: string;
        daemonPort: number; hasSshPassword: boolean; hasPassphrase: boolean }
type RemoteDaemonState = { state: "unknown" | "checking" | "running" | "stopped" | "not_installed" | "starting" }
  | { state: "cli_outdated"; version: string }
  | { state: "failed"; reason: "not_healthy" | "timeout" | "bad_output" | "exec_failed" | "no_shell" };
snapshot(): { …; remote: RemoteDaemonState | null }
remote: { start(): Promise<void>; refresh(): Promise<void> }
sshHosts(): Promise<SshHostSuggestion[]>                    // § 3, ssh_config_hosts
```

`NewDaemon` and `DaemonPatch` gain the SSH fields of § 2.

The desktop host's `connection.createTransport` returns the proxied transport for every kind. When
`transport_open` rejects with one of the SDK's relay reasons and the current entry is `relay`, the
proxied transport rejects with a `RelayConnectError` of that reason (D4); every other code stays
an `Error` with the command's message. The desktop host's `files` use the engine for every kind
(D6).

### 10. Workbench surfaces

| Surface | Contract |
|---|---|
| Add and edit form | A third kind, SSH. Fields: name, host, user, port, key file, jump host, daemon port (6767), SSH password, key passphrase, daemon password. Above the host field, the hosts of `~/.ssh/config` as a list: choosing one sets the host and, when empty, the name, and shows the config's user, port, key and jump host as placeholders (S12). Secrets follow the existing rule: never shown, a "saved" marker, a Clear action |
| Daemons row, SSH entry | The address text and, for the current entry, its state. `stopped` and `failed`: Start. `not_installed`: "pi-studio is not installed on this host", the command `npm install -g @av-pi-studio/cli` and a Copy button (D22). `cli_outdated`: the same command, with both versions. Retry probes again |
| Daemons screen | Opens by itself in the cases of S8 |
| Relay entry | Unchanged for the user: the wrong-link mark, Replace link and the relay messages come from the same `RelayConnectError` reasons |
| Connection failure | The message of the command, for every new code |

### 11. What the control socket sees, and the log

`ui.inspect`'s `connection` gains, with no address, user name, fingerprint or link:

```
transports[i].via: "direct" | "relay" | "ssh"
ssh: { state: "none" | "connecting" | "open", hops: number, channels: number }
```

`lastError.code` may be any code of § Error handling. The log holds codes and fixed texts only:
never a link, a relay host, an SSH host or user, a key path, a fingerprint, or the output of a
remote command.

### 12. Where the code lives

| Piece | Place | Rule |
|---|---|---|
| Link parser, kind `ssh`, registry version 3, `RemoteState` | `model` | Pure |
| Secret kinds | `secrets` | |
| Commands, the dial plan per kind, the remote request queue | `engine` | No socket |
| The remote daemon's supervisor (probe, Start) over a command-runner hook; `cli_answers` reused | `shell` | No socket: the app fills the hook |
| `DaemonSocket`, `dial_over`, the new codes, the proxy over `DaemonSocket` | `net` | Knows neither the relay nor SSH |
| Session id, channel, connect | New crate `pistudiodesktop-relay`, layer 8 | Depends on `net`; in `xtask/src/layers.rs` with a test that only apps use it |
| Config, known hosts, login, session, channel, `run` | New crate `pistudiodesktop-ssh`, layer 8 | The same |
| `Connector` returns `DaemonSocket`; the codes classed | `transfer` | |
| The branch per kind in `transport_open` and in the engine's connector, the one SSH session, the host-key dialog, `ssh_config_hosts` | The app binary | |
| The form, the row, the types | `packages/workbench` | Drawn only when `host.daemons` exists |
| Every kind proxied, the reason rethrown, the engine for every kind | `desktop/apps/pistudiodesktop/src/host/` | |

New dependencies (`crypto_box`, `russh` and what it brings, `ssh2-config`, `form_urlencoded`) are
checked against the permissive-licence rule and listed in `ATTRIBUTION.md`.

## Behavior & algorithms

### Opening a connection

```
transport_open(url):
    entry = owner thread: the current entry and what the kind needs
    refuse address_mismatch when url is not the address of S3 for this entry
    reservation = Proxies::reserve(entry.id)
    socket = by kind:
        local, direct:  net::dial(url, stored password)                         # unchanged
        relay:          link = secret store (blocking pool); parse
                        Relay  -> relay::connect(link, 128 MiB)
                        Direct -> net::dial(ws://host, no password)
        ssh:            session = the shared session, opened if needed (§ 7)
                        stream  = session.open_daemon(daemonPort)
                                  refused by the host's daemon port -> daemon_not_running; probe (§ 8)
                                  refused by the server's rules    -> forwarding_refused
                        net::dial_over(stream, ws://127.0.0.1:<daemonPort>, stored daemon password)
                        on success: remote state = running
    reservation.open(socket, origin); answer { localUrl }
```

The engine's connector does the same with the engine's message limit and without a reservation.

### An unknown host key (S6)

```
on host_key_unknown for (host, port, key), outside the connect that failed:
    if a question for this key is open or was answered No since the page loaded: nothing
    ask in a native dialog:  the host and port, the key type, its SHA-256 fingerprint,
                             and for a hop, that it is a jump host;  Trust / Cancel
    Trust  -> append "<host or [host]:port> <key type> <key>" to the app's known_hosts
              emit connection_resume { reason: "network" }
    Cancel -> remember the refusal until boot or daemon_switch
```

A changed key has no dialog: the message names the host and the two files, and says to remove the
old key there if the change is expected.

### What the engine retries

| Retried | Final |
|---|---|
| `unreachable`, `timeout`, `handshake`, `relay_unreachable`, `daemon_offline`, `daemon_unresponsive`, `too_many_clients`, `daemon_not_running`, `ssh_lost` | `wrong_key`, `daemon_outdated`, `protocol_error`, `invalid_link`, `auth_failed`, `host_key_unknown`, `host_key_changed`, `passphrase_needed`, `key_unreadable`, `forwarding_refused`, `ssh_config`, and those final today |

### After a sleep or a network change

Nothing new. The signals of milestone 2 fire; the page's ping and the SSH keepalive find a dead
connection; the SDK and the engine open again, which redials the relay or the SSH connection.

## Data & persistence touchpoints

- `daemons.json` version 3 (§ 1). An older app sets a version 3 file aside and starts with the
  local entry only; with the file backend it also sets `secrets.json` aside (D17).
- Secret store: two kinds added.
- `known_hosts` in the app's configuration directory.
- Read, never written: `~/.ssh/config` and its includes, `~/.ssh/known_hosts`, key files.
- In memory: the remote state, the SSH session, refused host keys.
- On the host: nothing but what `pi-studio daemon start` writes.

## Error handling & edge cases

New codes of `transport_open` (each with a message for a person):

| Code | When |
|---|---|
| `invalid_link` | The stored link does not parse |
| `relay_unreachable`, `daemon_offline`, `daemon_unresponsive`, `too_many_clients`, `daemon_outdated`, `wrong_key`, `protocol_error` | The SDK's relay reasons, by the same rules: close 4102–4105 by name; 4200 or a bad `ready` is `wrong_key`; a close without a code before pairing is `relay_unreachable`; anything else before the channel is open is `protocol_error` |
| `ssh_config` | `~/.ssh/config` does not parse, or names a `ProxyCommand` for the host |
| `host_key_unknown`, `host_key_changed` | § 7 |
| `auth_failed` | Every login was refused. The message lists what was tried (agent, key files by name, password), never a secret |
| `passphrase_needed` | A key needs a passphrase that is not stored, and nothing else logged in |
| `key_unreadable` | The entry's key file is missing or in a format the library does not read |
| `forwarding_refused` | The server does not allow the channel (`AllowTcpForwarding`, `PermitOpen`) |
| `daemon_not_running` | The host refused the connection to the daemon's port |
| `ssh_lost` | The SSH connection ended while a channel was being opened |
| `known_hosts` | `~/.ssh/known_hosts` or the app's file exists but cannot be read (added while building: trusting a key cannot fix it) |

An SSH host that cannot be reached is `unreachable` or `timeout`, with the host named; a failure
at a hop uses the same codes and names the hop.

| Case | Behaviour |
|---|---|
| A rotated daemon key | `daemon_offline`, as the relay reports it |
| A relay leg not read for two relay pings (60 s) | The relay closes it with 4108; the SDK or the engine connects again |
| A relay closes an open connection | The page sees the relay's close code, as with the SDK's transport; a channel failure is 4200 |
| Two relay connections per window | The page's and the engine's each count against the daemon's 32 |
| The daemon behind SSH has a password and the entry none | `unauthorized`, as direct |
| A daemon on the host listens on another port | `daemon_not_running`; the user sets the entry's daemon port |
| An account that may forward but not run commands | It connects; a probe or Start gives `failed/no_shell` |
| A host whose login shell is not POSIX-like or fish | The markers may not print: `failed/no_shell`. Not checked (§ TODO) |
| Start while a probe or Start runs | `busy` |
| The entry is edited while its SSH connection is open | The connection is closed; the next open uses the new values |
| `daemon.remote.*` when the current entry is not `ssh` | `wrong_kind` |
| An older app after this one ran | D17 |

## Dependencies on other specs

| Spec | Change |
|---|---|
| [desktop-transport-bridge.md](desktop-transport-bridge.md) | T1 ends: every kind is bridged. § 2 `transport_open`, § 4 host members, § 7 `ui.inspect`, the error table, the CSP |
| [desktop-daemon-registry.md](desktop-daemon-registry.md) | § 1 version 3 and kind `ssh`, § 2 commands, § 3 `HostDaemons`, § 4 surfaces; the sentence that a pairing link reaches the page |
| [desktop-transfer-engine.md](desktop-transfer-engine.md) | D2's "a relay entry keeps the page's path" ends; the connector's type; `FINAL_CODES` |
| [../architecture/workbench-host-adapter.md](../architecture/workbench-host-adapter.md) | `HostDaemons` |
| [../architecture/ssh-gateway-connections.md](../architecture/ssh-gateway-connections.md) | Superseded for the desktop client by this document |
| `desktop/AGENTS.md`, `desktop/docs/architecture.md` | Rule 10 (no command returns a secret, without exception), the layer table, "sockets live in `net`, `relay` and `ssh`" |

## Acceptance criteria

**Relay, in tests**
- [x] A Rust test reads `packages/protocol/fixtures/external-clients/relay/manifest.json`, fails on
  an unlisted or missing file, rebuilds `hello`, `ready` and the two client messages byte for byte
  from `keys.json`, opens the two daemon messages, and derives `sessionId`. (`sharedKey` is proved
  indirectly: `crypto_box` keeps it inside `SalsaBox`, and the sealed frames match only with the same key.)
- [x] The link vectors pass in TypeScript and in Rust, including a key that is not 32 bytes, both
  `host` and `relay`, a scheme on `relay`, and missing padding.
- [x] Against the relay stand-in: each close code before pairing gives its reason; a silent relay
  gives `timeout` at the limit (a 300 ms limit in the test; the 15 s is the constant); a bad `ready` gives `wrong_key` and close 4200; a frame that does not
  open after the channel is up closes 4200 and delivers nothing.

**Relay, in the real webview (Linux)**
- [x] A relay entry connects through a relay started from the repository to a daemon on loopback;
  chat and a terminal work; `ui.inspect` shows a transport with `via: "relay"` (the `via` field arrived
  with sprint 128/t005 and is asserted in the app's tests; the live relay run saw the daemon's own `via`).
- [x] No answer of any page command holds the link (`secret_guard`), and the log of the run holds
  neither the link nor the relay's host.
- [x] A link with a wrong key marks the entry and offers Replace link; with the daemon stopped the
  page shows the offline message and connects by itself once the daemon is back.
- [x] A link with a host hint connects directly.

**SSH, in tests (in-process server)**
- [x] Login with a key file, an encrypted key with its passphrase, an agent, and a password; the
  order of D11; `IdentitiesOnly`; the 6-attempt limit; `auth_failed`, `passphrase_needed`,
  `key_unreadable`.
- [x] Config: an alias with `HostName`, `User`, `Port`, `IdentityFile`; an include; the entry's
  fields winning; `ProxyCommand` and a malformed file giving `ssh_config`; `ProxyJump` with one and
  two hops.
- [x] Host keys: known in either file; unknown; changed; a non-default port.
- [x] `open_daemon` to a closed port gives `daemon_not_running`; a refused channel gives
  `forwarding_refused`; `run` returns status and output, cuts at 64 KiB and stops at its limit.

**SSH, in the real webview (Linux, sshd in the image)**
- [x] An SSH entry reaches a daemon that listens on loopback only, with each of the four logins and
  through a jump host; chat and a terminal work; `via: "ssh"`. (The jump-host chat and terminal were
  not repeated on the build that fixed the reconnect after Trust.)
- [x] A first connection shows the dialog; Trust connects without another action and the key is in
  the app's `known_hosts`; a host key changed on the server is refused. (Needed a fix: a page whose first
  connect failed never started its reconnection manager.)
- [x] With the daemon stopped the screen opens with Start; Start brings the daemon up and the page
  connects. With `pi-studio` off the PATH the row says not installed and Copy puts the command on
  the clipboard. With `pi-studio` found only by an interactive login shell (an nvm-like `.bashrc`), Start works.
- [x] The Add form lists the hosts of a `~/.ssh/config`; choosing one and saving gives an entry
  that connects.

**Transfers and recovery**
- [x] A 1 GiB upload and a 1 GiB save through the relay, and through SSH, give equal hashes while
  a terminal answers. The transfer's `peakHeld` is at most 1 MiB (1 MiB + 64 bytes). The app's Rust process grows by
  less than 32 MiB more for 4 GiB than for 1 GiB (at most +8.3 MiB). The rates are recorded
  (`desktop/docs/platform-checks.md` § Transfers: memory and rates).
- [x] After the app is stopped for 90 s and continued, and after the container's network is taken
  away and given back, a relay entry and an SSH entry are connected again without a reload, and a
  transfer in flight finishes with an equal hash.

**Build**
- [x] `cargo xtask ci` passes, with the two crates in the layer table.
- [x] The Linux, macOS and Windows builds pass with no `aws-lc` crate in `Cargo.lock` (Desktop CI is Linux only; the macOS and Windows builds are the manual run of `desktop-release.yml`, runs 45069793094 and 45081989872, which publish nothing; `cargo xtask layers` fails on an `aws-lc` package).
- [x] `ATTRIBUTION.md` lists the new dependencies and none has a licence the rule refuses.
- [x] The page's Content-Security-Policy allows no WebSocket address but `ws://127.0.0.1:*`, and
  the snapshot check passes.

## TODO(verify)

- [x] `russh` with `ring` and `rsa` builds on the macOS universal and Windows runners, and its
  dependencies (it pins `ssh-key` 0.7.0-rc) pass the licence rule. Seen in sprint 124/t002 and again on the finished feature.
- [x] `russh`'s known-hosts helpers read hashed entries and `[host]:port` entries of
  `~/.ssh/known_hosts`, but fail on one malformed line, ignore `@revoked` and wildcards and compare names
  case-sensitively: the lookup is written in the `ssh` crate.
- [x] `ssh2-config` gives `IdentitiesOnly` and `IdentityAgent` (as untyped fields, `unsupported_fields`).
- [x] How long the SDK waits for `transport.connect`: an SSH connection through hops may take 45 s
  (S9). Read in the code (2026-11-23): `DaemonClient.connect` awaits `transport.connect` with no
  timer of its own, and the desktop host's `proxied-transport.ts` has none, so Rust's 45 s
  `TOTAL_LIMIT` is the only limit. Not seen live with a slow hop.
- [x] Nothing in the workbench stores or shows the connect URL in a way that the addresses of S3
  change (`connect-current.ts` needed no change).
- [x] Nothing else in the page opens a WebSocket that S14 would block (the only `new WebSocket` is the browser connection, which the desktop host does not run).
- [ ] `"$SHELL" -lic` with markers on bash, zsh and fish hosts; other shells are not checked. Seen on bash only.
- [x] The SSH window and packet sizes that give a useful transfer rate: the channel window is 8 MiB (2.3-2.6x the saves at a 40 ms round trip against the 2 MiB default); the packet size stays at russh's 32 KiB (64 KiB gained nothing).
- [ ] The Windows agent (the OpenSSH pipe, Pageant), macOS and Windows as a whole: built, not run,
  by the owner's decision.
