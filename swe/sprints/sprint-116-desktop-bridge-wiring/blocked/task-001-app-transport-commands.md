# Task 001 — App binary: the five transport commands, the channel, closing on boot and switch

- **Sprint:** sprint-116-desktop-bridge-wiring
- **Status:** blocked
- **Type:** feature
- **Area:** desktop/apps/pistudiodesktop/src-tauri
- **Priority:** P1
- **Estimated size:** M
- **Depends on:** sprint-115/task-002, sprint-115/task-003, sprint-113/task-006

## Goal
The page can open, use and close a socket that Rust holds to the current entry's daemon, through five commands and one channel.

## Context / why
This joins the `net` crate to the webview. The page gets the least it needs: it cannot choose the address, it never sees the password, and a reload or a switch leaves no socket behind.

## Scope references
- `swe/features/desktop-transport-bridge.md` § 2 (commands, limits), § 3, § Opening a connection (the pseudocode), § Error handling, decisions P9, T1
- `desktop/apps/pistudiodesktop/src-tauri/build.rs` (the app manifest), `capabilities/default.json`, `src/commands.rs`, `src/commands/tests.rs` (the exact capability list), `src/daemons.rs`, `src/main.rs`
- `desktop/crates/net/`, `desktop/crates/secrets/`, `desktop/crates/model/` (the address rule)
- `desktop/docs/architecture.md` § The webview boundary, § Threads
- `desktop/AGENTS.md` rules 6 and 10

## What to build
- Commands `transport_open`, `transport_send_text`, `transport_send_binary` (raw body; `handle` and `seq` headers), `transport_ack`, `transport_close`, in the manifest, the capability and the handler list.
- `transport_open` as the pseudocode: one question to the owner thread for the current entry; `not_bridged` for a relay entry; the address rule; the limit of 4; the password read from the secret store on the blocking pool when the registry says there is one (`secret_missing`, `secret_unavailable`); the dial; then the connection with the channel as its sink.
- Socket tasks run on Tauri's async runtime; frames never cross the owner thread.
- `boot` and `daemon_switch` close every connection with 1001; so does the window closing.
- Errors are `{ code, message }`; no answer, error or log line contains a password.

## Out of scope
- `ui.inspect` (task-002).
- The page's side (task-003).
- Removing the password from `daemon_resolve_current` (task-004).

## Acceptance criteria
- [ ] With a local WebSocket server in the test: open, echo text and binary both ways, close with a code, and the channel ends with `closed`.
- [ ] A URL that is not the current entry's is `address_mismatch`; a relay entry current is `not_bridged`; a fifth open is `limit`.
- [ ] An entry whose password is missing from the store is `secret_missing`; a marker password reaches the server as the bearer subprotocol and appears in no answer or log line.
- [ ] After `boot` and after `daemon_switch` the server saw every earlier connection close with 1001.
- [ ] The capability test pins exactly the previous list plus the five commands; a command not on it is refused.
- [ ] `cargo xtask ci` passes.

## Test / verification plan
- `cargo test -p pistudiodesktop`
- `cargo xtask ci` in `desktop/`

## Notes
- Adding a command means three places (`build.rs`, the capability, `generate_handler!`); the test asserts the list.
- The channel's own fetch command needs no permission (read in Tauri 2.12.5); do not add a `core:` permission.

## Blocker
The benchmark gate failed (sprint-112/task-007, 2026-11-22; `swe/notes/desktop-ipc-benchmark.md` § Verdict). On the Windows runner the batched channel missed B1 (median 1.2 ms slower, mark 1 ms), B2 at 4 KiB and 64 KiB (33.5 and 34.7 MiB/s, mark 40), B4 (29.9 MiB/s, mark 88.8), B4 memory growth and B5 (28.6 MiB/s, mark 42.4) in three full runs; on macOS it missed B4 in two of three; on Linux B4 and B4 memory growth. The per-frame channel missed more. Decision T3: §§ 2–3 of the spec are not built. Unblock when the owner has chosen a design (sprint-112/task-008); this task is then rewritten for that design, or dropped.

Expected if the owner picks the loopback proxy (not decided): rewritten: one command that opens the proxy and answers a local URL, instead of five commands and a channel.
