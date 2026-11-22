# Task 001 — App binary: `transport_open`, the proxied connections, closing on boot and switch

- **Sprint:** sprint-116-desktop-bridge-wiring
- **Status:** backlog
- **Type:** feature
- **Area:** desktop/apps/pistudiodesktop/src-tauri
- **Priority:** P1
- **Estimated size:** M
- **Depends on:** sprint-115/task-002, sprint-115/task-003, sprint-113/task-006

## Goal
The page can ask Rust for a connection to the current entry's daemon and gets a local address to connect to; Rust holds the socket to the daemon.

## Context / why
This joins the `net` crate to the webview. The page gets the least it needs: it cannot choose the address, it never sees the password, the local address works once for a few seconds, and a reload or a switch leaves no socket behind.

## Scope references
- `swe/features/desktop-transport-bridge.md` § 2 (the command, limits), § 3 (the page's leg), § Opening a connection (the pseudocode), § Error handling, decisions T1, T5, P9, P11–P13
- `desktop/apps/pistudiodesktop/src-tauri/build.rs` (the app manifest), `capabilities/default.json`, `src/commands.rs`, `src/commands/tests.rs` (the exact capability list), `src/daemons.rs`, `src/main.rs`
- `desktop/crates/net/`, `desktop/crates/secrets/`, `desktop/crates/model/` (the address rule)
- `desktop/apps/ipc-bench/src/proxy_commands.rs` (how the calling webview's origin is read)
- `desktop/docs/architecture.md` § The webview boundary, § Threads; `desktop/AGENTS.md` rules 6 and 10

## What to build
- One command, `transport_open`, in the manifest, the capability and the handler list: input `{ url }`, answer `{ localUrl }`.
- As the pseudocode: one question to the owner thread for the current entry; `not_bridged` for a relay entry; the address rule (`address_mismatch`, `invalid_address`); the limit of 4; the calling webview's origin; the password read from the secret store on the blocking pool when the registry says there is one (`secret_missing`, `secret_unavailable`); the dial within 15 s; then the `net` crate's proxy with that origin and the entry's id.
- Socket tasks run on Tauri's async runtime; frames never cross the owner thread or Tauri IPC.
- `boot` and `daemon_switch` close every proxied connection; so does the window closing.
- Errors are `{ code, message }`. No answer, error or log line contains a password; `localUrl` is in the command's answer and nowhere else.
- `desktop/docs/architecture.md` (the command table, the webview boundary) and `desktop/AGENTS.md` describe the command.

## Out of scope
- `ui.inspect` (task-002).
- The page's side (task-003).
- Removing the password from `daemon_resolve_current` (task-004).

## Acceptance criteria
- [ ] With a local WebSocket server in the test: `transport_open` answers a local address; a client that connects to it with the page's origin echoes text and binary through the server and closes with a code the server sees.
- [ ] A URL that is not the current entry's is `address_mismatch`; a relay entry current is `not_bridged`; a fifth open is `limit`.
- [ ] An entry whose password is missing from the store is `secret_missing`; a marker password reaches the server as the bearer subprotocol and appears in no answer or log line; the client's upgrade response carries no subprotocol.
- [ ] After `boot` and after `daemon_switch` the server saw every earlier connection close with 1001.
- [ ] The capability test pins exactly the previous list plus `transport_open`; a command not on it is refused.
- [ ] `cargo xtask ci` passes.

## Test / verification plan
- `cargo test -p pistudiodesktop`
- `cargo xtask ci` in `desktop/`

## Notes
- Adding a command means three places (`build.rs`, the capability, `generate_handler!`); the test asserts the list.
- The origin is read from the calling webview, not written as a constant: it is `tauri://localhost` on Linux and macOS and `http://tauri.localhost` on Windows.
