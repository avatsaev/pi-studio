# Feature — Desktop Transport Bridge

> **Status: built and checked, 2026-11-22 (sprints 112–117). Open: the steps that need a person on a
> real machine (the five-minute sleep, an unsigned macOS build's keychain prompts, a firewall
> prompt) and the upload's pause on `bufferedAmount`, which WebKitGTK does not show (checklist
> M1–M6, `desktop/docs/platform-checks.md`).** The benchmark gate failed for the channel design
> (§ 1, Result); the owner then chose a loopback WebSocket proxy owned by Rust (T5), §§ 2–3 were
> rewritten for it, and it was built in sprints 115–116 and checked in sprint 117. Milestone 2 of
> the desktop client. Decisions T1–T5 are the owner's; P1–P10 were proposed here and accepted by the
> owner on 2026-11-21, with the note that the goal is to reach milestones 2, 3 and 4 in that order;
> P11–P16 were proposed with the rewrite and accepted by the owner on 2026-11-22. **Version:** the
> desktop app is 0.1.0 (`desktop/Cargo.toml`); a release that carries this milestone should be
> 0.2.0 (the first change to what the app does since 0.1.0); the number is set when the release is
> tagged, which needs the owner's word.

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
connect. This feature moves the socket to the daemon of a `local` or `direct` entry into Rust (the
page reaches it through a short loopback leg, T5), keeps secrets in the operating system's
keychain, and tells the workbench when the machine woke or the network changed. The check for the
whole feature: sleep the machine, wake it, and the session recovers without a reload.

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
| T5 | **2026-11-22, after the gate failed.** The bridge is a loopback WebSocket proxy owned by Rust, on all three platforms (§§ 2–3): Rust holds the socket to the daemon, and the page reaches Rust with its own `WebSocket` to `127.0.0.1`. This is the design T3's "another bridge design" led to; the loopback leg in the webview is accepted |

Proposed in this document and accepted by the owner on 2026-11-21:

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

Proposed with the rewrite of 2026-11-22 and accepted by the owner the same day:

| # | Decision | Why |
|---|---|---|
| P11 | The page's leg: one listener per connection on `127.0.0.1`, port chosen by the system, closed at the page's upgrade or after 10 s; a single-use 256-bit token in the path; `Origin` must be the app's own page and `Host` the loopback address | Measured this way on all three platforms. The port exists for milliseconds, not for the app's lifetime; the origin stops every browser tab, the token every other local program |
| P12 | Rust dials the daemon before it answers `transport_open` | A failed dial is the command's error with its real reason (wrong password, certificate, unreachable), which a browser socket cannot report |
| P13 | The page's leg carries no secret: Rust adds the password on the daemon's leg. The token is the only credential the page handles, for at most 10 s, and it is never logged | The purpose of the feature: the password stays in Rust |
| P14 | The memory marks change. B4's becomes "no more growth than the baseline in the same run, plus 64 MiB"; the bridge criterion becomes a bound on what Rust holds, with the app's growth reported | The written mark assumed the channel's window, and today's WebSocket misses it on Linux and Windows |
| P15 | A page that stops reading is not protected: the webview buffers what arrives, as today. Rust's own hold is bounded (a write batch and a frame per direction) | Measured (the proxy's W1). Milestone 3 takes transfers off this connection |
| P16 | The benchmark keeps its channel candidates, and the channel-only parts of the `net` crate (frame codec, inbound window, order buffer) move into the benchmark application | Nothing else uses them now, and a later run can still compare all four transports |

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
| B1 | Keystroke echo: 2,000 round trips of a 32-byte binary frame, one at a time | Round-trip time: mean, median and 99th percentile, minus the baseline's. WebKit's timer steps by 1 ms, so there the median and 99th percentile read 0 or 1 and the **mean** decides (measured 2026-11-21: baseline round trip about 30–45 µs on Linux) | Median at most 1 ms slower; 99th percentile at most 5 ms slower; where the timer is coarse, mean at most 1 ms slower |
| B2 | Terminal flood: 256 MiB inbound as binary frames of 4 KiB, 64 KiB and **256 KiB** (a real flood measured 2026-11-21 arrives at a median of about 350 KiB, p99 about 475 KiB, max 553 KiB; the first two sizes cover a slow producer) | MiB/s | At least 40 MiB/s (xterm.js states it parses 5–35 MB/s, so the bridge is not the limit) |
| B3 | Many small frames: 200,000 inbound text frames of 200 bytes | Frames/s | At least 5,000 (ten flooding terminals are 2,500 frames/s at one frame per 4 ms; the rest is headroom for agent streams) |
| B4 | Download: 1 GiB inbound as 32 KiB binary frames | MiB/s; growth of the app's processes | At least half the baseline and at least 40 MiB/s (P2); growth at most the baseline's in the same run plus 64 MiB (P14, 2026-11-22; before that: the channel's inbound window plus 64 MiB, the mark the runs of 2026-11-21 were judged on) |
| B5 | Upload: 256 MiB outbound as 32 KiB binary frames, paced on `bufferedAmount` at 1 MiB | MiB/s; `bufferedAmount` at the end | At least half the baseline and at least 40 MiB/s; back to 0 |
| B6 | Order and integrity, in every workload: each frame carries a counter, each stream a running hash | Frames reordered, lost or changed | None, in every run on every platform |
| B7 | B1 while B4 runs | 99th-percentile round trip | Reported only: one socket is shared, as today (milestone 3 separates them) |
| B8 | 1,000 inbound frames/s for 30 s with the window hidden, then shown | Frames lost; bytes Rust held; delay of a 500 ms worker timer while hidden | No loss; held bytes within the window. The timer delay is reported and decides P7 |

The candidates first measured were two variants of a design over Tauri's channel (one channel
message per frame, and several frames batched into one message; outbound the same two). After the
failure a fourth transport was measured: the loopback proxy that §§ 2–3 now describe.

**Outcome.** The gate passes when every row with a pass column passes on all three platforms with
one variant. A row that fails only on a virtual runner, within 20 % of its threshold, is measured
again on a real machine before the gate is called failed. The note
`swe/notes/desktop-ipc-benchmark.md` holds the numbers per platform, the variant chosen and the
webview versions.

**If it fails (T3).** § 2–3 are not built. A design task compares other bridges in the same
benchmark application and proposes one to the owner. Candidates, none evaluated: a WebSocket served
by the app on `127.0.0.1` with a per-launch token; a streamed response from a custom URI scheme for
the inbound direction. §§ 5–6 and `onResume` (§ 4) do not depend on the outcome.

**Result (2026-11-22): the gate failed.** Numbers, runs and versions:
`swe/notes/desktop-ipc-benchmark.md` § Results on three platforms. No variant of the channel
passes every gated row on all three platforms. On the Windows runner the batched variant carried
about 30 MiB/s whatever the workload and missed B1 (median 1.2 ms slower), B2 at 4 KiB and 64 KiB
(33.5 and 34.7 MiB/s), B4 (29.9 MiB/s against 88.8), B4 memory growth and B5 (28.6 against 42.4)
in three full runs that agree within 3 %; B4 and B5 miss by more than the 20 % a real machine
could excuse. On macOS it missed B4 in two of three runs; on Linux B4 (the half-the-baseline rule
only) and B4 memory growth. The per-frame variant missed more, and on macOS one of its messages
was never delivered, which froze that connection. Per T3, §§ 2–3 are not built and the tasks of
sprints 115 and 116 are blocked. The first candidate above was then built into the benchmark
(`proxy-ws`: one listener per connection, a single-use token, an `Origin` check) and measured on
all three platforms: it met every mark except B4 memory growth on Windows and Linux, which the
baseline misses by more. The streamed custom-scheme response was not measured. **The owner chose
the loopback proxy on 2026-11-22 (T5).** No pass mark was changed; P14 proposes a change.

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

### 2. The page's command

One command is added to the app manifest, the capability and `generate_handler!` (the existing
test of the exact capability list is extended by one). The Content-Security-Policy does not
change: `ws:` already allows `ws://127.0.0.1:<port>` and stays for relay entries (T1).

| Command | Input | Answer | Errors (`{code, message}`) |
|---|---|---|---|
| `transport_open` | `{ url }` | `{ localUrl }`, which is `ws://127.0.0.1:<port>/<token>`, once Rust's WebSocket to the daemon is open (P12) | § Error handling |

- `url` is what the workbench derived from the current entry's stored address (P9). Rust applies
  the same rule to the stored address (`normalizeDaemonUrl`: `http` becomes `ws`, `https` becomes
  `wss`, a bare host gets `ws://`, trailing slashes are trimmed) and requires the two to be equal;
  shared test vectors keep the two implementations alike. For the local entry the address is the
  running daemon's `ws://<host>:<port>`. Only `ws:` and `wss:` are dialled.
- Rust reads the entry's password from the secret store and offers the daemon the subprotocol
  `pi-studio.bearer.<password>`; with no password it offers none. The password is never an input
  of the command and never part of an answer, an error or a log line (P13).
- `localUrl` is a credential for at most 10 s (P11). It is answered to the calling page only and
  appears in no log line, event, error or `ui.inspect` view.
- At most 4 proxied connections exist at a time (waiting for the page, or open). `boot` and
  `daemon_switch` close all of them.
- A message above 128 MiB in either direction closes the connection with 1009 on both legs.
- There is no command to send, acknowledge or close: after `transport_open` the page uses its own
  `WebSocket` to `localUrl`, and frames never cross Tauri IPC.

### 3. The proxy

```
page (webview) --WebSocket, plain, loopback--> Rust --WebSocket, TLS for wss--> daemon
```

**The page's leg (P11).** For each `transport_open` Rust binds a TCP listener on `127.0.0.1` with a
port chosen by the system and accepts exactly one WebSocket upgrade:

| Check | Rule |
|---|---|
| Path | `/<token>`: 256 random bits as 64 hexadecimal digits, compared in constant time. It works once; a wrong guess does not use it up |
| `Origin` | Exactly the calling webview's origin, read from the webview (`tauri://localhost` on Linux and macOS, `http://tauri.localhost` on Windows; seen in the benchmark) |
| `Host` | `127.0.0.1:<port>` |
| Subprotocol | The page offers none and none is answered: the bearer subprotocol the daemon echoed is not passed back |
| Time | The listener is closed when the upgrade is accepted, or after 10 s. With no page in time, the daemon's leg is closed (1001) and the connection forgotten |
| Refusal | A bare 403 that does not say which check failed; Rust logs the reason without the token. At most 16 upgrade attempts are in progress, each given 2 s |

After the upgrade no listener remains: the port is closed.

**The pump.** One task per direction. A WebSocket message passes to the other leg unchanged and in
order, text as text and binary as binary. Each leg answers its own WebSocket pings; pings and
pongs are not passed on, and Rust sends none (the liveness check is the SDK's JSON `ping`, which
passes through like any message).

**What Rust holds.** A direction reads its next messages only when the write of the previous ones
to the other leg has completed, so Rust holds at most a write batch (256 KiB or 64 messages) and
one message per direction, whatever the flood, and a leg that is not read slows the other through
TCP. That bounds Rust, not the webview (P15): the webview reads its socket whether or not the
page's script runs, so a blocked page makes the webview buffer what arrives in its own memory
(measured: a 128 MiB flood during a 3 s block), exactly as it does today.

**`bufferedAmount`** is the webview socket's own. It rises when Rust, and so the daemon, takes an
upload more slowly than the page sends, so uploads stay paced as today (measured: row B5).

**Closing.**

| What happens | The page sees | The daemon sees |
|---|---|---|
| The daemon closes with a code and reason | The same code and reason | The answer to its close |
| The page closes with a code and reason | Its close completed | The same code and reason; Rust waits up to 2 s for the answer, then drops the socket |
| The daemon's leg ends without a close frame (reset, keepalive, a TLS error) | Its socket dropped without a close frame: code 1006 | Nothing |
| The page's leg ends without a close frame (reload, crash) | Nothing | Close 1001 |
| `boot`, `daemon_switch`, the window closing | Its socket dropped | Close 1001 |
| A message above 128 MiB | Close 1009 | Close 1009 |

The page learns only the close code. Rust records why a connection ended abnormally as
`lastError` (§ 7) and logs it.

The channel design that failed the gate (five commands, a Tauri channel, an acknowledgement window
and an order buffer) is no longer part of this document; it is in the benchmark application
(`desktop/apps/ipc-bench`), in `swe/notes/desktop-ipc-benchmark.md` and in the repository's history
before 2026-11-22.

### 4. Host members

The desktop host's `connection`, replacing the browser host's:

| Member | Behaviour |
|---|---|
| `createTransport(target, options)` | Current entry `local` or `direct`: a proxied `Transport` (below). Current entry `relay`: what the browser host returns. `options.password` is ignored for a proxied entry |
| `timers` | Unchanged: the browser host's worker timers (P7) |
| `onResume(listener)` | The browser host's triggers (window visible again, `online`) and the app's `connection_resume` event |

The proxied `Transport` is the SDK's WebSocket transport (`createWebSocketTransport`) with one
member replaced, so the desktop package still constructs no socket itself:

| Member | Behaviour |
|---|---|
| `connect(url)` | `transport_open { url }`, then the SDK transport's own `connect(localUrl)`. Rejects with an `Error` whose message is the command error's `message`; when the socket to `localUrl` does not open, rejects with the `local_connection` message (§ Error handling). May be called again after a close: each call is a new `transport_open` |
| Everything else | The SDK WebSocket transport's, unchanged: messages in wire order, binary as `ArrayBuffer`, `bufferedAmount`, one `onClose(code, reason)` per connection |

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
| `wake` | A tick every 2 s compares both the wall clock and a steady clock with the time expected; 10 s or more unaccounted for in either is a wake (a system sleep moves only the wall clock, a stopped process moves both) | A backward clock is not a wake. Also fires after the process was stopped and continued, or the clock was set forward: harmless |
| `network` | The non-loopback, non-link-local addresses of interfaces that are up are read every 5 s (every 1 s while a change settles); a change that leaves at least one address fires after 1 s without another change | A signal the 5 s limit refuses is kept pending (one per reason) and goes out when the limit allows; it is never dropped |

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
                  framesIn, framesOut, bytesIn, bytesOut,
                  peakHeldIn, peakHeldOut } ],
  lastError: { code, atMs } | null,
  resumeSignals: { wake: number, network: number }
}
```

No address, no secret, no frame content.

A transport is `connecting` from `transport_open` until the page's upgrade is accepted, `open`
while the pump runs, and `closing` during a close handshake. `framesIn` and `bytesIn` count what
went from the daemon to the page. `peakHeldIn` and `peakHeldOut` are the most bytes Rust held for
that connection in one direction at any moment (sprint-115/task-002; the Bridge criterion for a
1 GiB file reads them). `lastError.code` is an error code of `transport_open`, or one of
`page_refused`, `page_timeout`, `upstream_lost`, `too_large` for a connection that ended
abnormally. When no page gets in time it is `page_refused` if the gate refused at least one
attempt and `page_timeout` otherwise; `page_refused` is also recorded when the page's leg breaks
the protocol after getting in (invalid UTF-8, for example); a page that simply leaves (a reload)
records nothing. The token and `localUrl` are never in this view.

| The page's command, the set of proxied connections, the resume ticker | The app binary (`src-tauri`, `transport.rs`) | Socket tasks run on Tauri's async runtime. Frames never cross the owner thread or Tauri IPC; `transport_open` asks the owner thread once for the current entry (`Session::plan_bridge` → `BridgePlan`, carried by `LocalOp::Bridge`; the secret is read on the blocking pool). `net::check_address` refuses a bad address before a place is reserved |

| Piece | Place | Rule |
|---|---|---|
| Dialling (TCP, TLS, the upgrade), the loopback listener and its checks, the pump, the limits | Crate `pistudiodesktop-net`, no workspace dependency, native only | Only the app binary depends on it; registered in `xtask/src/layers.rs` so that neither `engine` nor `shell` can. Tested without Tauri, against local servers and with hostile input. The codec, inbound window and order buffer built for the channel design move to the benchmark application (P16) |
| The secret store and its backends | New crate `pistudiodesktop-secrets`, beside `store` (L3), native only | The engine uses it as it uses `store`; empty on wasm32 |
| The page's command, the set of proxied connections, the resume ticker | The app binary (`src-tauri`) | Socket tasks run on Tauri's async runtime. Frames never cross the owner thread or Tauri IPC; `transport_open` asks the owner thread once for the current entry |
| The proxied transport, `onResume` | `desktop/apps/pistudiodesktop/src/host/` | A wrapper around the SDK's WebSocket transport: no change in `packages/workbench` or `packages/client`. One workbench change comes from § 5: the registry view gains `secretStore` and the Daemons screen draws its line, with `workbench-host-adapter.md` amended in the same task |
| The benchmark application | `desktop/apps/ipc-bench` | § 1 |

`desktop/docs/architecture.md` says no socket exists below the app binary; that sentence becomes
"sockets live in `net` only". TLS trusts the operating system's certificate store and nothing
else: there is no switch to accept an untrusted certificate.

## Behavior & algorithms

### Opening a connection

```
transport_open(url):
    entry = owner thread: the current entry (kind, address)
    refuse not_bridged       when entry.kind is relay
    refuse address_mismatch  when url differs from the entry's stored address after the address rule
    refuse invalid_address   when the scheme is not ws or wss, or the URL has user information
    reservation = Proxies::reserve(entry.id)   refuse limit when 4 proxied connections exist
                                               (reserved before the dial: a fifth never dials)
    origin = the calling webview's origin
    password = blocking pool: secret store get(entry.id, password), if the registry says it has one
    refuse secret_missing    when the registry says so and the store has none
    within 15 s overall:
        resolve, connect, TLS for wss, WebSocket upgrade with the bearer subprotocol if any
    on failure: the matching error of § Error handling
    reservation.open(daemon socket, origin)    bind 127.0.0.1 on a free port; token = 256 random
                                               bits (proxy_failed; also refused when the socket's
                                               message cap exceeds 128 MiB)
    the connection is registered since reserve (entry id, counters, state connecting)
    in a task:
        accept one upgrade that passes § 3's checks, within 10 s
            accepted -> close the listener; state open; pump both directions until either leg
                        ends; end the other leg as § 3's table says
            none     -> close the daemon's leg with 1001
        forget the connection; set lastError when it ended abnormally
    answer { localUrl: "ws://127.0.0.1:<port>/<token>" }
```

### Launch and migration (P5)

```
at launch, before the registry is used:
    choose the secret backend (keychain, else file)
    if daemons.json is version 1:
        for each entry with a password or a pairing link: store it
        if every store succeeded: write version 2 without secrets
        else: keep the version 1 file byte for byte, serve secrets from memory for this run, add one
              `secrets_not_moved` notice; `daemon.add/update/remove` answer `secret_store_failed`
              meanwhile (a version 2 file must not claim secrets only this run holds)
```

A `daemons.json.corrupt-*` copy from milestone 1 is not touched: it may still hold secrets
(documented already).

Version 2 of the file: `password` and `pairingLink` are gone; an entry has `hasPassword: boolean`
(`local`, `direct`); a `relay` entry's link is in the store. A `relay` entry with `hasPassword: true`
is a wrong shape, as are repeated ids and a field the kind does not have.

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
password or the token:

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
| `limit` | 4 proxied connections exist |
| `local_not_ready` | The current entry is a local one whose daemon is being started or still needs a start (sprint-116/task-001). Other states of a local entry answer the codes of `daemon_resolve_current` (`local_stopped`, `cli_missing`, …) unchanged |
| `proxy_failed` | Rust could not bind `127.0.0.1` or get random bytes for the token |

One more failure is raised by the host, not by the command: `local_connection`, when the page's
socket to `localUrl` does not open (security software blocks loopback, or more than 10 s passed).
Its message says that the app could not open its own local connection and that security software
may be blocking `127.0.0.1`. Rust sets `lastError` to `page_refused` or `page_timeout`. A refused `transport_open` is reported to the SDK's transport as a close (1006) before the promise rejects, because the daemon client leaves `connecting` only on a close (found live, sprint-116/task-005); the connection bar then shows the short reason and the message in its tooltip.

| Condition | Expected behavior |
|---|---|
| The page reloads, or the entry is switched | Every proxied connection is closed (1001 to the daemon); the old page's sockets are gone with it |
| The window is hidden or the page is slow | Rust holds at most a write batch and a message per direction; the webview buffers what the page has not read, as today (P15); nothing is lost |
| Another program connects to the local port | 403 without the token and the page's origin. The page's own connect still works, because a wrong guess does not use the token up. After the page connected the port is closed |
| The daemon closes with a code and reason | The page's socket closes with the same code and reason; the workbench's reconnect decides what follows |
| The network drops without a close | TCP keepalive ends the daemon's leg within about a minute and Rust drops the page's leg (1006); a wake or network signal makes the workbench probe sooner |
| The keychain asks the user and they refuse | `secret_unavailable`; the connection bar shows the message; Retry asks again |
| The keychain is unreachable at launch | The `file` backend for this run, and the one line in the Daemons screen |
| A password changed in Daemons while connected | Stored at once; used at the next connect. The open socket is not touched |
| A relay entry is current | The webview's socket and the pairing link in the page, exactly as in milestone 1 |
| The 0.1.0 app opens a version 2 file | It sets the file aside and shows only the local entry (P5); the newer app's file is the `.corrupt-` copy |
| A daemon behind an HTTP proxy | Not reachable through the bridge (P6) |
| An unsigned build on macOS | Expected: the keychain asks again after each update, because the item is bound to the build's signature. Accepted by the owner for now (signing is milestone 5); to verify |

## Dependencies on other specs

- `workbench-host-adapter.md` — the `connection` member's contract, which this implements without changing.
- `desktop-daemon-registry.md` — § 1 (the file), § 3 (`resolveCurrent`) and the Secrets rules are amended by §§ 4–5 here; its decision D13 ("the keychain replaces this in milestone 2") is carried out.
- `desktop-native-host.md` — the page's command list and the capability test grow by one command.
- `connection-resilience.md` — the probe and the reconnect ladder are used as they are.
- `file-explorer-transfer.md` — `bufferedAmount` keeps its meaning, so upload pacing is unchanged.

## Acceptance criteria

Benchmark:

- [x] Given the benchmark application, when it runs on Linux, a macOS runner and a Windows runner, then `swe/notes/desktop-ipc-benchmark.md` holds every row of § 1 for each platform, three runs each, with the baseline, the variant chosen and the webview versions. (2026-11-22. Gaps: the Linux result files were lost, so Linux shows the worst of three without the three values, and the WebKitGTK version is not recorded; no variant was chosen because the gate failed.)
- [x] Given those results, then the gate is stated as passed or failed against P1, and on a failure nothing of §§ 2–3 is built before the owner accepts another design. (2026-11-22: failed; sprints 115 and 116 are blocked.)

Bridge (the loopback proxy, T5):

- [x] Given a `direct` entry with a password, when the window connects, then the page's only `WebSocket` goes to `127.0.0.1`, `ui.inspect` shows one open transport with `framesIn` above zero, and the password appears in no command answer, event, log line or page memory dump. *(Linux, 2026-11-22, sprint-116/task-005: the real WebKitGTK webview in `pi-desktop-xvfb`, a production daemon with a password on a free port. `ui.inspect` showed one `open` transport, `framesIn` 7; the daemon showed one client; the page constructed only `ws://127.0.0.1:<port>/<64 hex>` with no protocols, a second one on another port with another token after the daemon was killed and restarted. `daemon_resolve_current` answered `{connect, url}` without a password. A scan of `/proc/<pid>/mem` of the WebKit web and network processes found the password 0 times in each and the page's own token 14 and 11 times (positive control); the Rust process held the password 8 times; the debug app log and control replies held neither password nor token.)*
- [x] Given the proxied connection, when a terminal runs a command that prints 100 MiB, then the output is complete and in order, and typing stays responsive. *(Linux, 2026-11-22, sprint-116/task-005: three runs of 104.9 MiB (1,000,000 lines each): no gap, no bad line, the printed SHA-256 equals the host's; 1.51 to 1.62 s from Enter to the checksum line (about 70 MiB/s); a key typed every 60 ms during the flood echoed at the page after 25 ms median and 36 to 46 ms at most, against 5 to 6 ms idle; Rust's `peakHeldIn` at most 550,276 bytes.)*
- [ ] Given a 1 GiB file, when it is downloaded and uploaded through the proxy, then both copies are byte-identical, Rust never held more than 1 MiB of the connection's messages (a peak counter shows it), the app's memory growth is reported beside the same transfer of milestone 1, and an upload pauses and resumes on `bufferedAmount` (P14). *(Linux, 2026-11-22, sprint-116/task-005: shown except the last clause. Download 6.17, 6.32, 6.58 s (155 to 166 MiB/s), upload 6.27, 6.41 s, SHA-256 equal both ways, against 6.44 and 6.63 s with the same page on the webview's own socket and sprint 104's 6.5 s; `peakHeldIn` 262,160 and `peakHeldOut` 65,540 bytes, and 262,160 out with the daemon stopped for 6 s; memory growth of app plus WebKit: download +137 to +186 MiB (webview's socket +137 to +146, sprint 104 +116), upload about +2.08 GiB in both modes, so it is the webview's. Open: `bufferedAmount` never exceeded 32,904 bytes, with or without the daemon stopped, in either mode, because WebKitGTK hands the bytes to its network process (which grew by about 890 MiB during the stall): the pause cannot be seen on Linux. Left for the macOS and Windows runs of sprint 117.)*
- [x] Given a `relay` entry, when it is opened, then it connects as in milestone 1 and no proxied transport exists. *(Linux, 2026-11-22, sprint-116/task-005: a scratch relay and a second daemon, an entry from `--json daemon pair`: "connected", `transports` `[]`, `lastError` null, the page's only socket `ws://127.0.0.1:<relay port>`, the relay logged the paired connection.)*
- [x] Given a wrong password, a stopped daemon, an expired certificate and a host the daemon does not allow, when each is opened, then the connection bar shows the matching message and Retry works once the cause is fixed. *(Linux, 2026-11-22, sprint-116/task-005, after two fixes it found: the bar stayed on "connecting…" after any refused open, because the SDK leaves that state only on a close, so the host now reports a refused open as a close (1006); and a 401 or a certificate error read "connection refused", because `shortConnectionReason` tested `refus` first. Shown: wrong password "auth failed" (`unauthorized`); stopped daemon "connection refused" (`unreachable`); an untrusted and an expired certificate "certificate rejected" (`tls`, the tooltip says which); a host not allowed "host not allowed" (`host_not_allowed`); each recovered with one Retry once fixed. Screenshots were kept outside the repository.)*
- [x] Given a page reload or a switch, then every earlier connection is closed, the daemon saw 1001, and `ui.inspect` lists none of them. *(Linux, 2026-11-22, sprint-116/task-005: sampled every 20 ms: never more than one transport; the old client left with 1001 and the new one connected 91 ms (reload) and 101 ms (switch to another entry of the same daemon) later; a switch to a relay entry gave `[]`.)*
- [x] Given the page's command list, then exactly one command was added, the capability test pins the list, and an open to an address other than the current entry's is refused. *(2026-11-22, sprint-116/task-001: the capability test pins the previous fifteen plus `transport_open`; six URL forms are `address_mismatch`. Live, sprint-116/task-005: an open to another address or scheme from the page answered "The page asked for an address that is not the current daemon's." and an unlisted command "Command not found".)*
- [x] Given an answered `transport_open`, when another client connects to the port without the token, with another origin, or after the page has connected, then it is refused (403, or the port is closed), the page's own connection is unaffected, and the token is in no log line and no `ui.inspect` view. *(Sprint-115/task-002 tests cover a wrong token, origin and host, a second use, and a closed port after the upgrade. Live on Linux, sprint-116/task-005: a new listening port appeared 285 ms after the click; strangers with wrong tokens (with the right Origin, no Origin, another Origin, a wrong Host, no path, 20 more attempts) each got a bare 403 and the page then connected; afterwards the app listened on no proxy port and a later attempt got `ECONNREFUSED`; the debug log has "refused an upgrade" lines and no token. Not run live: a right token with a wrong Origin or Host, and a second use of the token, which only the page holds; they are in `crates/net/src/proxy/tests/gate.rs`.)*

Secrets:

- [x] Given a version 1 `daemons.json` with a password and a pairing link, when the new app starts, then both are in the secret store, the file is version 2 with neither, and both entries still connect. *(Linux, 2026-11-21, sprint-113/task-008: the real webview in `pi-desktop-xvfb`, scratch `--config-dir`, a password-protected daemon and a local relay on free ports. A version 1 file with a direct entry and a relay entry became version 2, `hasPassword` true for the direct one, no secret in it; `secrets.json` (0600) held both; the direct entry showed `connected`, and the relay entry, chosen in the switcher, showed `connected` too and the relay logged a paired connection.)*
- [x] Given the keychain backend, when an entry is added, edited and removed, then its item appears, changes and disappears in the OS keychain (checked with the platform's own tool on macOS, Windows and Linux). *(Linux shown 2026-11-21, sprint-113/task-008, and again with the whole feature built 2026-11-22, sprint-117/task-001: in `pi-desktop-keyring`, no option gave `secretStore` `keychain`; `secret-tool search` showed the password item appear on add, change on edit, go on clearing, return, and go on remove, and the link item the same, a rename changed nothing; `daemons.json` held no secret and no `secrets.json` was made. macOS and Windows: the hosted runners, run 44979817186, 2026-11-22, sprint-117/task-002: with `--secret-store keychain` and a scratch `--config-dir`, `security find-generic-password` found a direct entry's password item after add, its modification date moved after the edit and it was gone after remove (the runner's login keychain); `cmdkey /list` showed the Credential Manager target after add and not after remove; no prompt on either. Not shown: a person's own macOS keychain with an unsigned build after an update (checklist M3), which is a different question from this criterion.)*
- [x] Given no keychain (a container without a Secret Service), when the app starts, then `secretStore` is `file`, `secrets.json` is mode 0600, and the Daemons screen shows the line. *(Linux, 2026-11-21, sprint-113/task-008: no option, `pi-desktop-xvfb` without a Secret Service: `boot` said `file`, `secrets.json` was mode 600, and a screenshot of the Daemons screen shows "Passwords and pairing links are kept in a file only this user can read, because no keychain is available." In the same run the page showed a notice that no keychain could be reached.)*
- [x] Given the secret guard test, when it runs with marker secrets (a password and a proxy token) through every command, the supervisor and a proxied connect, then no answer, event or log line contains a password marker, and the token marker is only in the answer of `transport_open`. *(Sprint-116/task-002 and 004 and sprint-117/task-001, 2026-11-22: `cargo test -p pistudiodesktop-shell --test secret_guard` passes with the marker password through the commands, the supervisor, the owner thread, `boot` and the connection view, the marker token in the view's hook, and a check that the page's answers carry no password (shown failing once with the field put back); the app's tests search `ui.inspect` and the captured log for the password, the token and `127.0.0.1`; `pistudiodesktop-net`'s marker test covers errors, log lines and snapshots; the live scans of sprint-116/task-005 found the token in the page's memory and nowhere in the log or the control replies. The token clause rests on those together rather than on one test.)*

Resume:

- [x] Given a connected window on Linux, when the app's processes are stopped for 30 s while the daemon is restarted, then continued, then `resumeSignals.wake` rises by one and the session is connected again within 10 s, without a reload. (Linux 2026-11-21, 114/t004: wake +1, connected 12 ms after the continue, page not reloaded, the socket was the webview's. Again through the proxy, 2026-11-22, 117/t001: stopped 30,005 ms, daemon restarted with `kill -9`; wake 0 to 1; the old page socket closed 1006 at +38 ms and a new socket on another port with another token opened at +95 ms; the bar read `connected` at +100 ms; one `open` transport, `lastError` `upstream_lost` for the old one; the page's marker, `timeOrigin` and history length unchanged, so no reload. A daemon that is frozen, not restarted (processes and daemon stopped 30 s, the app continued, the daemon 12 s later): wake +1, the page's `ping` at +44 ms with no `pong`, `disconnecting…` at +5.05 s (the 5 s probe), the socket closed 4000 at +7.05 s because Rust waits up to 2 s for the frozen daemon's answer, `connected` 6 ms after the daemon continued; the transports went `open`, `closing`, none, `connecting`, `open`, never two at once.)
- [x] Given an interface address added or removed, then `resumeSignals.network` rises by one and no more than one event is emitted in 5 s. (Linux 2026-11-21, 114/t004: a dummy interface; add or remove +1; two changes 2 s apart gave one event; a change 39 ms after a wake was delivered 6.0 s after it. The page's reaction, 2026-11-22, 117/t001: with the session open an added address gave `network` 0 to 1 and one `ping` from the page 4.96 s later, its `pong` 3 ms after, no new socket and no change in the bar (the transport the same, counters up by one); removing the address gave one more ping and pong and no reconnect.)
- [ ] Given a real machine of each kind (Linux, macOS, Windows), when it sleeps for five minutes with a session open and wakes, then the session recovers without a reload. A person runs this one; it is added to `desktop/docs/platform-checks.md`.

Gates and documents:

- [x] `cargo xtask ci` passes, with the two new crates registered in the layer table and the wasm check unchanged; the root gates pass. *(2026-11-22, sprint-117 close, the combined tree: `cargo xtask ci` all 8 steps passed (layers, with `net` now unable to depend on a UI crate; wasm); root `npm run build && typecheck && lint && test` exit 0, 291 files and 4,134 tests; the app's `npm run check`, `lint` and `npm test` (195 tests). Desktop CI on GitHub passed on the pull request.)*
- [x] `desktop/AGENTS.md` (rule 10, "Where it stands"), `desktop/docs/architecture.md` (commands, secrets, "What stays out of the core"), `desktop/README.md`, `docs/desktop-client-handoff.md`, `desktop/docs/platform-checks.md` and the root `AGENTS.md` describe what was built. *(2026-11-22, sprint-117/task-004; `swe/features/desktop-daemon-registry.md` and `swe/architecture/workbench-host-adapter.md` amended too. A search of `desktop/`, `docs/`, the root `AGENTS.md` and `swe/features/` for "still opens the WebSocket" and for secrets living in `daemons.json` finds only text that describes history.)*

## TODO(verify)

- **The numbers of P1 (partly answered, 2026-11-21).** xterm.js's 5–35 MB/s is its documentation's figure, not measured here. A real flood's frame sizes were measured (`swe/notes/desktop-ipc-benchmark.md`, dev daemon with a real PTY, a Node consumer, a fast machine): median about 354 KiB, so B2 gained a 256 KiB size; a slower producer gives smaller frames, which the 4 KiB and 64 KiB sizes cover. The 40 MiB/s and 5,000 frames/s marks are still derived, not measured.
- **Which IPC path each webview uses (answered, 2026-11-21).** Raw bodies travelled by the custom protocol as raw bytes on all three webviews; none was sent as a JSON array. Invokes did reach Rust out of order with one message per frame (15,844 on macOS and 1,188 on Windows in one run, at most 29 waiting) and never with batches. This mattered to the channel design only; with the proxy (T5) frames do not cross Tauri IPC.
- **Why one channel message was lost on macOS** (run 3 of the benchmark, per-frame variant): not reproduced, cause unproven. Any design that keeps Tauri's channel needs a stall watchdog.
- **A real Windows machine** was not measured: the Windows figures are a 4-logical-core runner's.
- **The keychain crate (answered, 2026-11-21, sprint-113/task-002; run on the runners 2026-11-22, sprint-117/task-002).** `keyring-core` with one store crate per platform (`zbus-secret-service-keyring-store`, `apple-native-keyring-store`, `windows-native-keyring-store`), all MIT OR Apache-2.0 with their dependencies; the Linux backend needs a D-Bus session bus and a Secret Service, and is pure Rust. The macOS and Windows crates compiled and worked on the hosted runners (add, edit and remove with no prompt).
- **How the engine reaches the store without blocking the owner thread (answered, sprint-113/task-004 and 005).** A pure `plan` on the owner thread and a `finish` or `SecretJob` step on a worker thread; see `desktop/docs/architecture.md` § Decisions and § Threads.
- **macOS and an unsigned build (partly answered, 2026-11-22, sprint-117/task-002).** A GitHub runner can use the keychain unattended: on macOS (login keychain) and on Windows (Credential Manager) add, edit and remove of a password went through with no prompt. Still open: whether the keychain prompts after every update of an unsigned build (checklist M3, a person on a Mac).
- **The TLS crates' licences (answered, 2026-11-22, sprint-115/task-001; builds seen 2026-11-22, sprint-117/task-002).** `rustls` 0.23 (Apache-2.0 OR ISC OR MIT) with `ring` 0.17.14 (Apache-2.0 AND ISC, no OpenSSL or SSLeay text) and `rustls-platform-verifier` 0.7.1 (MIT OR Apache-2.0); all permissive; `ring` needs a C compiler only, read from its `build.rs`; the app built with them on the macOS and Windows runners with no extra tool. The `net` unit tests were not run on those runners, and the expired-certificate reason is not checked on Apple, where the platform verifier may not report it.
- **The interface-address crate (answered, 2026-11-21).** `if-addrs` 0.15.0 (MIT OR BSD-3-Clause; read), 16 µs per reading on Linux (median of 200). It built on the macOS and Windows runners (2026-11-22, sprint-117/task-002).
- **Largest frame either side sends (answered, 2026-11-21).** Largest daemon text frame seen: 5,243,061 bytes (a 5 MiB `file_read_request`); largest binary: 553,220 bytes (a terminal `Output` frame); the client's largest: 32,770 bytes (an upload chunk). 128 MiB leaves ample room. Measured with the mock provider's small rows only: a session with large tool outputs was not measured.
- **Whether the app's 2 s tick runs while macOS naps a hidden app.** A stalled tick looks like a wake; the 5 s rate limit bounds the cost.
- **The control socket on Windows (answered, 2026-11-22, sprint-117/task-002).** It works there: the Windows job on a hosted runner read `ui.inspect` over it (`connection.transports`, `secretStore`, `lastError`, `resumeSignals.wake`) and added an entry through it.
- **A page memory dump (answered, 2026-11-22, sprint-116/task-005).** Taken by reading `/proc/<pid>/mem` of the WebKit web and network processes from the container as root: the password 0 times, the page's own token (positive control) 14 and 11 times. Done on Linux only.
- **The pause of an upload on `bufferedAmount`.** Not seen on WebKitGTK: it hands the bytes to its network process, so `bufferedAmount` stayed under 33 KB while that process grew by about 890 MiB with the daemon stopped. The runner checks of sprint 117 do not look at it; it is checklist step M6 (a person on Windows, through WebDriver) and the 1 GiB criterion stays open until then.
- **A 1 GiB upload grows the page by about 2 GiB** on WebKitGTK, identical on the webview's own socket and through the proxy (so not the proxy's doing; the SDK reads the file in the page). A subject for milestone 3, the transfer engine.
- **A certificate that is itself a CA** gives the vague message "was refused" (`TlsReason::Other`); a clearer phrase for that case is to choose.
- **Security software and the loopback leg (the proxy, T5).** Whether a firewall or endpoint-security product objects to an application that listens on `127.0.0.1` for a moment, or to a page connecting there. Not tested: the benchmark ran on stock runners. The Windows and macOS manual checks (sprint 117) look for a prompt.
- **A later webview that restricts loopback.** The page at `tauri://localhost` (or `http://tauri.localhost` on Windows) opened `ws://127.0.0.1:<port>` on WKWebView, WebView2 157 and WebKitGTK in the benchmark. Browsers have been tightening access to local addresses; whether that will reach an application's own page was not looked into. A failure shows as `local_connection`.
- **Parts of §§ 2–3 the benchmark's proxy did not have (answered in tests, 2026-11-22, sprint-115/task-001 and 002).** The bearer subprotocol on the daemon's leg, the `Host` check, TLS on the daemon's leg, the 128 MiB cap and the 2 s close wait are now tested in `pistudiodesktop-net` against local servers. Not tested: a failed bind, a failed random read, a half-open socket. The daemon always echoes the bearer subprotocol; tungstenite fails the upgrade if a subprotocol is offered and none is answered, so a middlebox that strips it gives `handshake`.
- **A close frame's answer.** In the benchmark and in `net` the answer to a forwarded close is the WebSocket library's echo of that code, not the other side's own answer. No client reads the answer, so this is expected to be harmless; to confirm against the SDK's close handling.
- **The layer check let `net` depend on a UI crate (found and closed, 2026-11-22, sprint-115/task-002).** `UI_MIN_LAYER = 6` allowed every layer at 6 or above, and `net` is layer 7; `xtask/src/layers.rs` now allows `tauri`, `wry` and `tao` at layer 6 only, with a test.
