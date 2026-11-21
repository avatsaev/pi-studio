# Feature — Desktop Transport Bridge

> **Status: specified 2026-11-21. Not planned, not built.** Milestone 2 of the desktop client.
> Decisions T1–T4 are the owner's; P1–P10 are proposed here and are accepted or changed at planning.

> Part of: [../MAIN-SCOPE.md](../MAIN-SCOPE.md)
> Dependencies: [../architecture/workbench-host-adapter.md](../architecture/workbench-host-adapter.md)
> (`connection.createTransport`, `timers`, `onResume`: the seam this fills),
> [desktop-daemon-registry.md](desktop-daemon-registry.md) (the registry, its secrets and
> `daemon_resolve_current`, all amended here), [desktop-native-host.md](desktop-native-host.md)
> (the desktop host, the page's command list), [connection-resilience.md](connection-resilience.md)
> (reconnect and the resume probe, unchanged), [file-explorer-transfer.md](file-explorer-transfer.md)
> (upload pacing on `bufferedAmount`), [../architecture/websocket-protocol.md](../architecture/websocket-protocol.md)
> Desktop rules: `desktop/AGENTS.md`, `desktop/docs/architecture.md`

## Purpose

In milestone 1 the webview opens the WebSocket to the daemon itself, so the connection depends on
the webview's timers and network stack, and a daemon's password is handed to the page at every
connect. This feature moves the socket of a `local` or `direct` entry into Rust, keeps secrets in
the operating system's keychain, and tells the workbench when the machine woke or the network
changed. The check for the whole feature: sleep the machine, wake it, and the session recovers
without a reload.

It starts with a benchmark, because nobody has measured whether Tauri's IPC can carry terminal
traffic. The benchmark is a gate (T3).

Not in this feature: the transfer engine and a second, bulk connection (milestone 3), the relay in
Rust (milestone 4), signing and auto-update (milestone 5), moving the handshake or reconnect into
Rust, an HTTP proxy for Rust's sockets (P6).

## Decisions

Owner, 2026-11-21:

| # | Decision |
|---|---|
| T1 | Only `local` and `direct` entries use the bridge. A `relay` entry keeps the webview's socket and the SDK's relay transport until milestone 4; its pairing link still reaches the page |
| T2 | The Rust code is written in this workspace. `pi-studio-dashboard` was a throwaway test application: nothing is taken from it or shared with it |
| T3 | The benchmark is a gate. If it fails, another bridge design is explored before anything else of the bridge is built. A socket left in the webview is not the fallback |
| T4 | The `hello` handshake, request/response matching, JSON `ping`/`pong` and `ReconnectionManager` stay in TypeScript (the handoff's rule). No store and no reducer changes |

Proposed, to accept at planning:

| # | Decision | Why |
|---|---|---|
| P1 | The pass thresholds of § 1 | They come from what the daemon sends (a terminal emits at most one frame per 4 ms; transfers use 32 KiB frames), not from a measurement |
| P2 | A file transfer through the bridge may be slower than today, down to half the direct rate, until milestone 3 | A download then crosses IPC twice (socket to page, page to disk). The transfer engine removes both hops |
| P3 | Passwords and pairing links both move to the secret store; `daemons.json` holds no secret | One rule for secrets at rest. T1 still hands a pairing link to the page at connect |
| P4 | Where the keychain is not available, secrets go to `secrets.json` (mode 0600) in the configuration directory and the Daemons screen says so | A Linux desktop without a Secret Service must keep working. Milestone 1 already stores them this way |
| P5 | `daemons.json` becomes version 2. The 0.1.0 app sets a version 2 file aside (`daemons.json.corrupt-*`) and starts with only the local entry | Checked: 0.1.0 refuses an unknown version. A downgrade is rare and loses no secret |
| P6 | Rust's sockets ignore the system's HTTP proxy settings (the webview's socket used them) | Out of scope; a daemon is normally on the machine, the LAN or a VPN. Listed as a known difference |
| P7 | Reconnect timers stay the browser host's worker timers. Rust adds resume signals only | The timers work today; a timer in Rust still needs the page to run. Revisit if § 1 row B8 shows them stalling |
| P8 | Wake is detected from a clock gap and a network change by polling the interface addresses. No OS notification API | Portable, no `unsafe`, no per-platform code. A false signal costs one 5 s probe |
| P9 | The page can open a bridged socket to the current entry only; Rust dials the stored address | The page must not make Rust send a stored password to an address of its choosing |
| P10 | `ui.inspect` reports the bridged connections (counters, no secret) | The macOS runner has no WebDriver: this is how an automated check sees that the page connected |

## Public contract

### 1. The benchmark (gate)

A small Tauri application kept in the repository beside the app (`desktop/apps/ipc-bench`), never
bundled or released, adding no command or permission to the shipped app. Its Rust side runs a
WebSocket server on `127.0.0.1`; its page runs each workload twice, over the page's own `WebSocket`
(the baseline, which is what the app does today) and over the candidate bridge, then hands the
numbers to Rust, which writes `results.json` and exits. It runs unattended on Linux (the Xvfb
container), on a macOS runner and on a Windows runner; each workload runs three times and the worst
run counts.

| # | Workload | Measured | Pass (P1) |
|---|---|---|---|
| B1 | Keystroke echo: 2,000 round trips of a 32-byte binary frame, one at a time | Round-trip time, median and 99th percentile, minus the baseline's | Median at most 1 ms slower; 99th percentile at most 5 ms slower |
| B2 | Terminal flood: 256 MiB inbound as 4 KiB and as 64 KiB binary frames | MiB/s | At least 40 MiB/s (xterm.js states it parses 5–35 MB/s, so the bridge is not the limit) |
| B3 | Many small frames: 200,000 inbound text frames of 200 bytes | Frames/s | At least 5,000 (ten flooding terminals are 2,500 frames/s at one frame per 4 ms; the rest is headroom for agent streams) |
| B4 | Download: 1 GiB inbound as 32 KiB binary frames | MiB/s; growth of the app's processes | At least half the baseline and at least 40 MiB/s (P2); growth at most the inbound window (§ 3) plus 64 MiB |
| B5 | Upload: 256 MiB outbound as 32 KiB binary frames, paced on `bufferedAmount` at 1 MiB | MiB/s; `bufferedAmount` at the end | At least half the baseline and at least 40 MiB/s; back to 0 |
| B6 | Order and integrity, in every workload: each frame carries a counter, each stream a running hash | Frames reordered, lost or changed | None, in every run on every platform |
| B7 | B1 while B4 runs | 99th-percentile round trip | Reported only: one socket is shared, as today (milestone 3 separates them) |
| B8 | 1,000 inbound frames/s for 30 s with the window hidden, then shown | Frames lost; bytes Rust held; delay of a 500 ms worker timer while hidden | No loss; held bytes within the window. The timer delay is reported and decides P7 |

The candidates measured are variants of one design (§ 2–3): one channel message per frame, and
several frames batched into one message; outbound the same two. The benchmark fixes the encoding,
and the result note records it.

**Outcome.** The gate passes when every row with a pass column passes on all three platforms with
one variant. A row that fails only on a virtual runner, within 20 % of its threshold, is measured
again on a real machine before the gate is called failed. The note
`swe/notes/desktop-ipc-benchmark.md` holds the numbers per platform, the variant chosen and the
webview versions.

**If it fails (T3).** § 2–3 are not built. A design task compares other bridges in the same
benchmark application and proposes one to the owner. Candidates, none evaluated: a WebSocket served
by the app on `127.0.0.1` with a per-launch token; a streamed response from a custom URI scheme for
the inbound direction. §§ 4–6 do not depend on the outcome.

Facts read in Tauri 2.12.5 on 2026-11-21, which the benchmark exists to put numbers on:

- A `Channel` numbers its messages and the page delivers them in that order.
- A raw message under 1,024 bytes, or a JSON message under 8,192 bytes, is delivered by evaluating a
  script that contains it (raw bytes as a JSON array of numbers). A larger one is delivered by a
  script that makes the page fetch the body: one more round trip per message.
- A raw body from the page travels as a `fetch` to `ipc://localhost`. If that fails once, Tauri
  falls back to `postMessage` for the rest of the run, where a raw body is a JSON array of numbers.
  The benchmark records which path each platform used.
- The channel's fetch command needs no permission; it is guarded by the per-launch invoke key and
  is scoped to the webview that owns the channel.
- Already measured (sprint 104, Linux): the page wrote 1 GiB to Rust through raw invokes in 6.5 s
  while also downloading it (about 160 MiB/s for the whole path).

### 2. The page's commands

Added to the app manifest, the capability and `generate_handler!` (the existing test of the exact
capability list is extended). The Content-Security-Policy does not change: `ws:` and `wss:` stay for
relay entries (T1).

| Command | Input | Answer | Errors (`{code, message}`) |
|---|---|---|---|
| `transport_open` | `{ url }` and a `Channel` | `{ handle }` once the WebSocket upgrade succeeded | § Error handling |
| `transport_send_text` | `{ handle, seq, data }` | Empty, once the frame was written to the socket | `unknown_handle`, `closed`, `too_large` |
| `transport_send_binary` | A raw body; headers `handle`, `seq` | The same | The same |
| `transport_ack` | `{ handle, bytes }` | Empty | `unknown_handle` |
| `transport_close` | `{ handle, code?, reason? }` | Empty | None: an unknown handle is ignored |

- `handle` is a random 128-bit value in hexadecimal, valid for one connection.
- `url` is what the workbench derived from the current entry's stored address (P9). Rust applies
  the same rule to the stored address (`normalizeDaemonUrl`: `http` becomes `ws`, `https` becomes
  `wss`, a bare host gets `ws://`, trailing slashes are trimmed) and requires the two to be equal;
  shared test vectors keep the two implementations alike. For the local entry the address is the
  running daemon's `ws://<host>:<port>`. Only `ws:` and `wss:` are dialled.
- Rust reads the entry's password from the secret store and offers the subprotocol
  `pi-studio.bearer.<password>`; with no password it offers none. The password is never an input
  of these commands and never part of an answer, an error or a log line.
- At most 4 bridged sockets are open at a time. `boot` and `daemon_switch` close all of them with
  code 1001 and forget their handles.
- A message above 128 MiB is refused in either direction: `too_large` for a send, and inbound the
  socket is closed with 1009.

### 3. The channel

Every message on the channel given to `transport_open` belongs to that connection, and the channel
keeps them in the order Rust sent them:

| Message | Meaning |
|---|---|
| Frames | One or more whole WebSocket messages in wire order, each marked text or binary |
| `{ closed: { code, reason, error? } }` | The socket is gone. Last message of the connection. `1006` when it ended without a close frame; `error` (`{code, message}`) says why when Rust knows |

The encoding of "Frames" is the benchmark's result (one message per frame, or a batch whose items
are `[kind: 1 byte][length: 4 bytes, little-endian][payload]`). Whatever it is, the transport calls
`onMessage` once per WebSocket message, synchronously and in order, with a string for text and an
`ArrayBuffer` for binary.

**Inbound window.** Rust counts the payload bytes it sent on the channel and the page acknowledges
what `onMessage` has returned from (`transport_ack`, every 256 KiB or 50 ms, whichever is first).
While more than 8 MiB is unacknowledged Rust stops reading the socket, so TCP slows the daemon,
which already paces a download on its send buffer. It reads again below 4 MiB.

**Outbound order.** `seq` starts at 0 for each connection and rises by one per send. Rust writes
frames to the socket in `seq` order: one that arrives early waits (at most 64 messages); a gap
that lasts 5 s closes the connection with the error `send_order`.

**`bufferedAmount`.** The page adds a frame's byte length when it sends and subtracts it when the
send's answer arrives. Since an answer means "written to the socket", the number has the meaning
the SDK expects and uploads stay paced.

### 4. Host members

The desktop host's `connection`, replacing the browser host's:

| Member | Behaviour |
|---|---|
| `createTransport(target, options)` | Current entry `local` or `direct`: a bridged `Transport` (below). Current entry `relay`: what the browser host returns. `options.password` is ignored for a bridged entry |
| `timers` | Unchanged: the browser host's worker timers (P7) |
| `onResume(listener)` | The browser host's triggers (window visible again, `online`) and the app's `connection_resume` event |

The bridged `Transport` implements the SDK's interface unchanged:

| Member | Behaviour |
|---|---|
| `connect(url)` | `transport_open` with a new channel. Resolves when it answers; rejects with an `Error` whose message is the error's `message`. May be called again after a close: each call is a new handle, and messages of an older handle are dropped |
| `sendText`, `sendBinary` | The two send commands, with the next `seq`. A failed send calls `onError`; it does not throw |
| `close(code = 1000, reason = "")` | `transport_close`. `onClose` is called when the `closed` message arrives, once per connection |
| `isOpen` | True from the answer of `transport_open` until `closed` or a local `close()` |
| `bufferedAmount` | § 3 |
| `onMessage`, `onClose`, `onError` | A `closed` message with `error` calls `onError` first, then `onClose(1006, "")` |

Event `connection_resume`, payload `{ reason: "wake" | "network" }`, emitted to the page (it may
already listen to events; nothing is added to the capability).

`daemon_resolve_current` answers `{ url, connect: true }` for a `local` or `direct` entry: no
`password`. For a `relay` entry it still answers the pairing link as `url` (T1), and that is now
the only secret a command returns.

### 5. The secret store

A store of small secrets keyed by entry id and kind (`password`, `pairingLink`), with three
backends:

| Backend | Used when | Where |
|---|---|---|
| `keychain` | The default | macOS Keychain, Windows Credential Manager, the Secret Service on Linux. Service `com.avatsaev.pi-studio`; account `<scope>/<entry id>/<kind>`, where `<scope>` is `default` or, with `--config-dir`, 16 hex digits of a hash of that directory |
| `file` | The keychain cannot be reached at launch (P4), or `--secret-store file` | `secrets.json`, mode 0600, in the configuration directory |
| `memory` | A session without a configuration directory (tests, `Session::new()`) | Nowhere |

- Operations: get, set, delete. Each can fail with `unavailable`, `denied` or `failed`; an error
  never contains a secret.
- A call may block on a system prompt (macOS asks before an application reads an item). It never
  runs on the owner thread or the main thread.
- The backend is chosen once per launch and reported as `secretStore` in the registry view and in
  `ui.inspect`. With `file`, the Daemons screen shows one line: secrets are kept in a file only
  this user can read, because no keychain is available.
- New launch option `--secret-store keychain|file`. The automated checks and the live checks pass
  `file`, so that they never write to a developer's keychain, except the checks of the keychain
  itself, which remove what they wrote.

Engine commands keep their contracts. `daemon.add` and `daemon.update` store a given secret before
the registry file is written, and fail with `secret_store_failed` (nothing written) when the store
refuses. `daemon.remove` deletes the entry's secrets; a failed delete is logged with the entry id
and reported as a notice, and the entry is still removed.

### 6. Resume signals

| Signal | Detection | Limits |
|---|---|---|
| `wake` | A tick every 2 s compares the wall clock with the time expected; 10 s or more unaccounted for is a wake | Also fires after the process was stopped and continued, or the clock was set forward: harmless |
| `network` | The set of non-loopback interface addresses is read every 5 s; a change that leaves at least one address fires after 1 s without another change | — |

At most one `connection_resume` every 5 s. Rust closes no socket on a signal: the workbench probes
with a 5 s ping and reconnects when that fails, as it does today for a tab that became visible.

A socket Rust owns has `TCP_NODELAY` set and TCP keepalive on (30 s idle, 10 s between probes, 3
probes, where the platform allows it). Rust answers WebSocket pings; it sends none of its own.

### 7. What the control socket sees (P10)

`ui.inspect` gains `connection`:

```
connection: {
  secretStore: "keychain" | "file" | "memory",
  transports: [ { entryId, state: "connecting" | "open" | "closing",
                  framesIn, framesOut, bytesIn, bytesOut } ],
  lastError: { code, atMs } | null,
  resumeSignals: { wake: number, network: number }
}
```

No address, no secret, no frame content.

### 8. Where the code lives

| Piece | Place | Rule |
|---|---|---|
| Socket, TLS, the frame codec, the inbound window, the outbound order buffer | New crate `pistudiodesktop-net`, no workspace dependency, native only | Only the app binary depends on it; registered in `xtask/src/layers.rs` so that neither `engine` nor `shell` can. The codec, window and order buffer are pure and tested with hostile input |
| The secret store and its backends | New crate `pistudiodesktop-secrets`, beside `store` (L3), native only | The engine uses it as it uses `store`; empty on wasm32 |
| The page's commands, the channel, the resume ticker | The app binary (`src-tauri`) | Socket tasks run on Tauri's async runtime. Frames never cross the owner thread; `transport_open` asks it once for the current entry |
| The bridged transport, `onResume` | `desktop/apps/pistudiodesktop/src/host/` | No change in `packages/workbench` or `packages/client` is expected. If the host contract must change, `workbench-host-adapter.md` is amended in the same task |
| The benchmark application | `desktop/apps/ipc-bench` | § 1 |

`desktop/docs/architecture.md` says no socket exists below the app binary; that sentence becomes
"sockets live in `net` only". TLS trusts the operating system's certificate store and nothing
else: there is no switch to accept an untrusted certificate.

## Behavior & algorithms

### Opening a connection

```
transport_open(url, channel):
    entry = owner thread: the current entry (kind, address)
    refuse not_bridged       when entry.kind is relay
    refuse address_mismatch  when url differs from the entry's stored address after the address rule
    refuse invalid_address   when the scheme is not ws or wss, or the URL has user information
    refuse limit             when 4 sockets are open
    password = blocking pool: secret store get(entry.id, password), if the registry says it has one
    refuse secret_missing    when the registry says so and the store has none
    within 15 s overall:
        resolve, connect, TLS for wss, WebSocket upgrade with the bearer subprotocol if any
    on failure: the matching error of § Error handling
    register handle -> (socket, channel, counters); start the read task and the write task
    answer { handle }
```

The read task forwards messages to the channel while the inbound window allows it. When the socket
ends it sends `closed` and removes the handle. The write task takes sends in `seq` order and
answers each after its write.

### Launch and migration (P5)

```
at launch, before the registry is used:
    choose the secret backend (keychain, else file)
    if daemons.json is version 1:
        for each entry with a password or a pairing link: store it
        if every store succeeded: write version 2 without secrets
        else: keep the version 1 file, use the file backend for this run, add a notice
```

A `daemons.json.corrupt-*` copy from milestone 1 is not touched: it may still hold secrets
(documented already).

Version 2 of the file: `password` and `pairingLink` are gone; an entry has `hasPassword: boolean`
(`local`, `direct`); a `relay` entry's link is in the store.

### After a wake

```
ticker sees a gap >= 10 s -> emit connection_resume { reason: "wake" }
page: onResume -> resolveResumeAction (unchanged):
    connection open        -> ping with a 5 s limit; on failure close(4000) -> reconnect in ~0.5 s
    waiting in backoff     -> reconnect now
reconnect: transport.connect(url) again -> a new transport_open
```

## Data & persistence touchpoints

| File or store | Change |
|---|---|
| `daemons.json` | Version 2: no secret; `hasPassword` on `local` and `direct` entries. Still mode 0600 |
| The OS keychain | One item per stored secret (§ 5). Removed with the entry |
| `secrets.json` | New, only with the `file` backend: `{ version: 1, items: { "<entry id>/<kind>": string } }`, mode 0600, written atomically |
| `settings.json`, `daemon-state/*.json` | Unchanged |

## Error handling & edge cases

`transport_open` errors. `message` is written for a person and names the host and port, never a
password:

| Code | When |
|---|---|
| `not_bridged` | The current entry is a relay entry (a host bug: it should not have asked) |
| `address_mismatch`, `invalid_address` | See the pseudocode |
| `secret_missing` | The registry says the entry has a password and the store has none. The message says to enter it again in Daemons |
| `secret_unavailable` | The store is locked, or the user denied access |
| `unreachable` | Name not resolved, connection refused, no route |
| `tls` | The certificate was refused; the message says why (expired, unknown issuer, wrong name) |
| `unauthorized` | The upgrade was answered 401: the password is wrong or missing |
| `host_not_allowed` | The upgrade was answered 403 (`PI_STUDIO_HOSTNAMES`) |
| `handshake` | Any other answer to the upgrade |
| `timeout` | 15 s passed |
| `limit` | 4 sockets are open |

| Condition | Expected behavior |
|---|---|
| The page reloads, or the entry is switched | Every bridged socket is closed (1001); frames for the old page are dropped |
| The window is hidden or the page is slow | Rust holds at most the inbound window and stops reading; nothing is lost |
| The page sends on a handle that closed | `closed` error; the transport calls `onError`, and `onClose` has already run |
| The daemon closes with a code and reason | `closed` carries them unchanged; the workbench's reconnect decides what follows |
| The network drops without a close | TCP keepalive ends the socket within about a minute; a wake or network signal makes the workbench probe sooner |
| The keychain asks the user and they refuse | `secret_unavailable`; the connection bar shows the message; Retry asks again |
| The keychain is unreachable at launch | The `file` backend for this run, and the one line in the Daemons screen |
| A password changed in Daemons while connected | Stored at once; used at the next connect. The open socket is not touched |
| A relay entry is current | The webview's socket and the pairing link in the page, exactly as in milestone 1 |
| The 0.1.0 app opens a version 2 file | It sets the file aside and shows only the local entry (P5); the newer app's file is the `.corrupt-` copy |
| A daemon behind an HTTP proxy | Not reachable through the bridge (P6) |
| An unsigned build on macOS | Expected: the keychain asks again after each update, because the item is bound to the build's signature. To verify |

## Dependencies on other specs

- `workbench-host-adapter.md` — the `connection` member's contract, which this implements without changing.
- `desktop-daemon-registry.md` — § 1 (the file), § 3 (`resolveCurrent`) and the Secrets rules are amended by §§ 4–5 here; its decision D13 ("the keychain replaces this in milestone 2") is carried out.
- `desktop-native-host.md` — the page's command list and the capability test grow by five commands.
- `connection-resilience.md` — the probe and the reconnect ladder are used as they are.
- `file-explorer-transfer.md` — `bufferedAmount` keeps its meaning, so upload pacing is unchanged.

## Acceptance criteria

Benchmark:

- [ ] Given the benchmark application, when it runs on Linux, a macOS runner and a Windows runner, then `swe/notes/desktop-ipc-benchmark.md` holds every row of § 1 for each platform, three runs each, with the baseline, the variant chosen and the webview versions.
- [ ] Given those results, then the gate is stated as passed or failed against P1, and on a failure nothing of §§ 2–3 is built before the owner accepts another design.

Bridge (only after the gate passed):

- [ ] Given a `direct` entry with a password, when the window connects, then the page's own `WebSocket` is never constructed, `ui.inspect` shows one open transport with `framesIn` above zero, and the password appears in no command answer, event, log line or page memory dump.
- [ ] Given the bridged connection, when a terminal runs a command that prints 100 MiB, then the output is complete and in order, and typing stays responsive.
- [ ] Given a 1 GiB file, when it is downloaded and uploaded through the bridge, then both copies are byte-identical, the app's memory stays within the window plus 64 MiB, and an upload pauses and resumes on `bufferedAmount`.
- [ ] Given a `relay` entry, when it is opened, then it connects as in milestone 1 and no bridged transport exists.
- [ ] Given a wrong password, a stopped daemon, an expired certificate and a host the daemon does not allow, when each is opened, then the connection bar shows the matching message and Retry works once the cause is fixed.
- [ ] Given a page reload or a switch, then every earlier socket is closed and `ui.inspect` lists none of them.
- [ ] Given the page's command list, then exactly the five commands were added, the capability test pins the list, and a bridged open to an address other than the current entry's is refused.

Secrets:

- [ ] Given a version 1 `daemons.json` with a password and a pairing link, when the new app starts, then both are in the secret store, the file is version 2 with neither, and both entries still connect.
- [ ] Given the keychain backend, when an entry is added, edited and removed, then its item appears, changes and disappears in the OS keychain (checked with the platform's own tool on macOS, Windows and Linux).
- [ ] Given no keychain (a container without a Secret Service), when the app starts, then `secretStore` is `file`, `secrets.json` is mode 0600, and the Daemons screen shows the line.
- [ ] Given the secret guard test, when it runs with marker secrets through every command, the supervisor and a bridged connect, then no answer, event or log line contains a marker.

Resume:

- [ ] Given a connected window on Linux, when the app's processes are stopped for 30 s while the daemon is restarted, then continued, then `resumeSignals.wake` rises by one and the session is connected again within 10 s, without a reload.
- [ ] Given an interface address added or removed, then `resumeSignals.network` rises by one and no more than one event is emitted in 5 s.
- [ ] Given a real machine of each kind (Linux, macOS, Windows), when it sleeps for five minutes with a session open and wakes, then the session recovers without a reload. A person runs this one; it is added to `desktop/docs/platform-checks.md`.

Gates and documents:

- [ ] `cargo xtask ci` passes, with the two new crates registered in the layer table and the wasm check unchanged; the root gates pass.
- [ ] `desktop/AGENTS.md` (rule 10, "Where it stands"), `desktop/docs/architecture.md` (commands, secrets, "What stays out of the core"), `desktop/README.md`, `docs/desktop-client-handoff.md`, `desktop/docs/platform-checks.md` and the root `AGENTS.md` describe what was built.

## TODO(verify)

- **The numbers of P1.** xterm.js's 5–35 MB/s is its documentation's figure, not measured here. The 4 KiB and 64 KiB frame sizes of B2 are guesses at what a 4 ms coalescing window produces: measure a real flood's frame sizes from a daemon before running B2.
- **Which IPC path each webview uses** for raw bodies (the `ipc://` fetch or the `postMessage` fallback), and whether invokes ever reach Rust out of order. § 3's `seq` assumes they can.
- **The keychain crate.** `keyring` 4.2.0 is MIT OR Apache-2.0 and needs Rust 1.88 (the workspace is on 1.95); its backends per platform and their licences were not read. The Linux backend needs a D-Bus session.
- **How the engine reaches the store without blocking the owner thread**: a step the caller runs before and after the command, or a hook in the style of `Services`. Decide in the first secrets task.
- **macOS and an unsigned build**: whether the keychain prompts after every update, and whether a GitHub runner can use a keychain unattended.
- **The TLS crates' licences** (`rustls` with `ring`, the platform certificate verifier) against the permissive-only rule, and whether `ring` builds on all three runners without extra tools.
- **The interface-address crate** (`if-addrs` 0.15.0, MIT OR BSD-3-Clause, not read) and the cost of reading the addresses every 5 s.
- **Largest frame either side sends.** The server sets no `maxPayload` on direct connections and the browser's socket has no limit, so the 128 MiB cap is a guess above the `ws` library's default.
- **Whether the app's 2 s tick runs while macOS naps a hidden app.** A stalled tick looks like a wake; the 5 s rate limit bounds the cost.
- **The control socket on Windows.** The Windows checks drive the page through WebDriver; whether `ui.inspect` is reachable there was not checked.
- **A page memory dump** as evidence that the password is absent: how to take one from WebKitGTK. If it cannot be done, the criterion is argued from the code path (the password is never an input or an output of a page command).
