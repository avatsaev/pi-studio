# Task 005 — Linux live checks for the bridge

- **Sprint:** sprint-116-desktop-bridge-wiring
- **Status:** blocked
- **Type:** test
- **Area:** desktop/docs
- **Priority:** P1
- **Estimated size:** M
- **Depends on:** task-002, task-004

## Goal
The bridge is shown to work in the real app on Linux against a real daemon: terminals, transfers, errors, reloads and relay entries.

## Context / why
Unit tests cannot show that a 100 MiB terminal flood stays in order through a real webview, or that a wrong password reads as one in the connection bar.

## Scope references
- `swe/features/desktop-transport-bridge.md` § Acceptance criteria (Bridge), § Error handling
- `desktop/docs/development.md` (the container, WebKitWebDriver, the control socket)
- `swe/sprints/sprint-104-desktop-dialogs-links-save/done/task-008-live-checks-documents-summary.md` (the 1 GiB run to compare with)

## What to build
- In the container, real webview, a scratch production daemon with a password (`--secret-store file`):
- (1) connect: `ui.inspect` shows one open transport with frames in, the daemon's status shows one client, and a script that counts `WebSocket` constructions on the page counts none across a reconnect;
- (2) a terminal command that prints 100 MiB ending in a checksum line: the checksum shown matches, and a key typed during the flood echoes;
- (3) a 1 GiB download and upload: equal SHA-256, the time taken against sprint 104's 6.5 s, the app's memory, and an upload that pauses on `bufferedAmount`;
- (4) a relay entry, if the local relay of the sprint-111 checks can be started: connects, and no transport is listed;
- (5) a wrong password, a stopped daemon, a TLS server with a certificate the system does not trust, and a host the daemon does not allow: the message in the connection bar for each, and Retry after the cause is fixed;
- (6) a page reload and a switch: no earlier transport is listed afterwards.
- A failed check is fixed in the task that owns the code, and that task's summary is reopened.

## Out of scope
- macOS and Windows (sprint 117).
- The resume checks with the bridge (sprint 117).

## Acceptance criteria
- [ ] Each of the six runs is in the summary with its commands and what was seen, including the screenshots of the error messages.
- [ ] The Bridge criteria of the spec that Linux can show are ticked with this evidence.
- [ ] The download's rate is at least half of the direct rate measured in sprint 104 (P2), or the summary says by how much it missed.
- [ ] `cargo xtask ci` passes.

## Test / verification plan
- `cargo xtask ci` in `desktop/`
- The live runs, always with a scratch `PI_STUDIO_HOME` and a free port.

## Notes
- The dev daemon has no password support worth testing here: use the production daemon (`npm start` with a scratch home) for (1) and (5).
- Typing "stays responsive" is a judgement: report the echo delay you measured.

## Blocker
The benchmark gate failed (sprint-112/task-007, 2026-11-22; `swe/notes/desktop-ipc-benchmark.md` § Verdict). On the Windows runner the batched channel missed B1 (median 1.2 ms slower, mark 1 ms), B2 at 4 KiB and 64 KiB (33.5 and 34.7 MiB/s, mark 40), B4 (29.9 MiB/s, mark 88.8), B4 memory growth and B5 (28.6 MiB/s, mark 42.4) in three full runs; on macOS it missed B4 in two of three; on Linux B4 and B4 memory growth. The per-frame channel missed more. Decision T3: §§ 2–3 of the spec are not built. Unblock when the owner has chosen a design (sprint-112/task-008); this task is then rewritten for that design, or dropped.

Expected if the owner picks the loopback proxy (not decided): carries over; the backpressure check changes (the webview buffers).
