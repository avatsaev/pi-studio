# Task 004 — SSH crate: the daemon channel, `dial_over`, and remote commands — Summary

- **Sprint:** sprint-127-desktop-ssh-client
- **Completed:** 2026-11-22
- **Status:** done (orchestrator)

## What was implemented
- `Session::open_daemon(port, password: Option<&str>, max_message_bytes) -> Result<DaemonSocket, DaemonError>`: `direct-tcpip` to `127.0.0.1:port`, then `net::dial_over` with `ws://127.0.0.1:<port>` (upgrade limited to `Limits::step`); `DaemonError::Channel(Error)` (`daemon_not_running`, `forwarding_refused`) or `Dial(DialError)`.
- `Session::run(command, limit) -> Result<Output{status: u32, stdout: Vec<u8>}, RunError>`: `"$SHELL" -lic 'echo <begin>; <command>; echo <end>:$?'` with fresh 128-bit markers per run; a scanner keeps 64 KiB of stdout in bounded memory and reads on to the end marker so the status stays right after a cut; stderr dropped; nothing logged; killed (`KILL`) at the limit; the channel is closed after every run. `NoShell` = refused exec or no begin marker; `ExecFailed` = failed channel open, lost connection, or a begin marker with no end marker or valid status (chosen here; the spec says no marker gives `no_shell`). Several channels run at once.
- `testing::shell(|inner| (stdout, status))` emulates a login shell (banner, markers).

## Files changed
`crates/ssh/src/{command.rs,command/tests.rs,session.rs,session/channels.rs,session/channels/tests.rs,error.rs,lib.rs,testing.rs}`, `crates/ssh/Cargo.toml` (dev-dependency `tokio-tungstenite`)

## Build & test results
```
cargo test -p pistudiodesktop-ssh -> 132 passed (also --features testing); clippy plain and with testing clean; fmt clean; wasm32 check ok
cd desktop && cargo xtask ci -> all 8 steps passed
```

## Acceptance criteria
- [x] A WebSocket through the in-process server to a stand-in daemon (Host header, bearer subprotocol); both refusals give different codes; two daemon sockets plus a `run` at once; `run` returns status and output, cuts at 64 KiB with the status intact, stops at its limit; `no_shell` when the server runs no command.

## Follow-ups
- `Output.stdout` is raw bytes: `cli_answers` parsing in the app decodes it (128/t004).
- `RunError::code()` gives the page's `failed.reason` strings.
- `cargo doc` warns about a link to the private `login` module (already in `lib.rs`).
