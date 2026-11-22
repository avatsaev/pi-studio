# Task 005 — Linux live checks for the proxy

- **Sprint:** sprint-116-desktop-bridge-wiring
- **Status:** backlog
- **Type:** test
- **Area:** desktop/docs
- **Priority:** P1
- **Estimated size:** M
- **Depends on:** task-002, task-004

## Goal
The proxy is shown to work in the real app on Linux against a real daemon: terminals, transfers, errors, reloads, relay entries, and a stranger at the local port.

## Context / why
Unit tests cannot show that a 100 MiB terminal flood stays in order through a real webview, that a wrong password reads as one in the connection bar, or that the local port is really closed once the page has connected.

## Scope references
- `swe/features/desktop-transport-bridge.md` § Acceptance criteria (Bridge), § Error handling, decisions P14, P15
- `desktop/docs/development.md` (the container, WebKitWebDriver, the control socket)
- `swe/sprints/sprint-104-desktop-dialogs-links-save/done/task-008-live-checks-documents-summary.md` (the 1 GiB run to compare with)
- `swe/notes/desktop-ipc-benchmark.md` (the rates the benchmark measured for the proxy)

## What to build
- In the container, real webview, a scratch production daemon with a password (`--secret-store file`):
- (1) connect: `ui.inspect` shows one open transport with frames in, the daemon's status shows one client, and a script that records every `WebSocket` the page constructs shows only addresses on `127.0.0.1`, across a reconnect too;
- (2) a terminal command that prints 100 MiB ending in a checksum line: the checksum shown matches, and a key typed during the flood echoes (report the delay);
- (3) a 1 GiB download and upload: equal SHA-256, the time taken against sprint 104's 6.5 s, the peak of what Rust held (at most 1 MiB), the app's memory growth beside sprint 104's, and an upload that pauses on `bufferedAmount`;
- (4) a relay entry, if the local relay of the sprint-111 checks can be started: connects, and no transport is listed;
- (5) a wrong password, a stopped daemon, a TLS server with a certificate the system does not trust, and a host the daemon does not allow: the message in the connection bar for each, and Retry after the cause is fixed;
- (6) a page reload and a switch: no earlier transport is listed afterwards, and the daemon logged the earlier client leaving;
- (7) the local port: while connected, the listening sockets of the app's process show no proxy port; a second client that races the page with a wrong token gets 403 and the page still connects; the app's log holds no token.
- A failed check is fixed in the task that owns the code, and that task's summary is reopened.

## Out of scope
- macOS and Windows (sprint 117).
- The resume checks with the proxy (sprint 117).

## Acceptance criteria
- [ ] Each of the seven runs is in the summary with its commands and what was seen, including the screenshots of the error messages.
- [ ] The Bridge criteria of the spec that Linux can show are ticked with this evidence.
- [ ] The download's rate is at least half of the direct rate measured in sprint 104 (P2), or the summary says by how much it missed.
- [ ] `cargo xtask ci` passes.

## Test / verification plan
- `cargo xtask ci` in `desktop/`
- The live runs, always with a scratch `PI_STUDIO_HOME` and a free port.

## Notes
- The dev daemon has no password support worth testing here: use the production daemon (`npm start` with a scratch home) for (1) and (5).
- Typing "stays responsive" is a judgement: report the echo delay you measured.
- For (7), delaying the page's connect long enough to race it may need a debug hook or a slow page script; if it cannot be done in the real app, say so and point to the `net` crate's test that covers it.
