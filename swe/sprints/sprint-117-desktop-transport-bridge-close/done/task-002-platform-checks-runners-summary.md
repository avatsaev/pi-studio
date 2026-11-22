# Task 002 — Automated platform checks on macOS and Windows runners for milestone 2 — Summary

- **Sprint:** sprint-117-desktop-transport-bridge-close
- **Completed:** 2026-11-22
- **Status:** done

## What was built
New in `desktop/apps/pistudiodesktop/scripts/platform-checks/`, each with a vitest file: `stand-in-daemon.mjs` (the Windows stand-in: `node:http` plus its own WebSocket framing, no dependency; answers `hello` with the `status` fixture's frame, a `ping` with a `pong`, reads the bearer password from the `pi-studio.bearer.<password>` subprotocol and echoes it); `bridge.mjs` (helpers: open transports, `stopAndContinue`, keychain scope, `security` and `cmdkey` parsing, skip reasons); `suspend.mjs` (macOS SIGSTOP/SIGCONT of the app's main pid; Windows a PowerShell script through `-EncodedCommand` calling `NtSuspendProcess`/`NtResumeProcess` on the app and its descendants, the webview's processes included); `macos-keychain.mjs` (`keychain.macos.item`: `--secret-store=keychain`, scratch `--config-dir`, add, edit, remove a direct entry with a password, `security find-generic-password` after each step, never `-w`/`-g`, the edit shown by the item's modification date, items deleted in a `finally`, skipped with a reason if the app exits, a control call waits 30 s for a prompt, or the store refuses; prints "unattended: yes/no"); `windows-bridge.mjs` (`bridge.windows.transport-open`, `.bar-connected`, `.stand-in`, `.wake`, and `keychain.windows.credential` through `cmdkey /list`, deleted in a `finally`).
Edited: `macos.mjs` (`bridge.macos.transport-open` after `daemon.local.start`, `bridge.macos.wake`, the keychain check at the end), `windows.mjs`, `app-process.mjs` (exports `KEYCHAIN_STORE_ARG`), `app-process.test.mjs` (pins that only `macos-keychain.mjs` and `windows-bridge.mjs` name the keychain option, each with a `--config-dir` and a deletion in a `finally`), the workflow (comments only), docs `desktop/docs/platform-checks.md`, `desktop/docs/development.md`, `desktop/AGENTS.md`.

## Deviation (for the owner)
Every live run uses `--secret-store file` **except two**: the macOS keychain check (asked for) and `keychain.windows.credential`, which the task needs for `cmdkey /list` to show a real Credential Manager write. Both use a scratch `--config-dir` on a throwaway runner and delete what they wrote in a `finally`; the unit test pins both. Drop `keychainCheck` from `runWindowsChecks` to remove the Windows one.

## Commands run
- Linux: `npx vitest run` in `desktop/apps/pistudiodesktop` (24 files, 195 tests passed, the scripts subset 14 files, 105 tests); `oxlint --type-aware --deny-warnings` clean; `actionlint` (docker `rhysd/actionlint`) exit 0; `cargo xtask ci` all 8 steps passed. The Windows page checks were rehearsed against the real WebKitGTK webview in `pi-desktop-xvfb` with the stand-in: 12 passed, 0 failed, 3 skipped (wake, Credential Manager, process count). The wake path by hand (SIGSTOP of the app's main pid for 15 s): wake 0 to 1, transport open again, page's ping reached the stand-in.
- GitHub (the pull request run, commit a392db8): **Desktop platform checks, run 44979817186: macOS 17 passed, 0 failed, 0 skipped; Windows 15 passed, 0 failed, 0 skipped.** Desktop CI passed (gate). The Desktop IPC benchmark run the push started (44979817199) was cancelled at once.

## What the runs printed
- macOS: one open transport for `local`, `framesIn` 7, `framesOut` 7, `secretStore` file, `lastError` none; the app's process stopped 15.0 s: `wake` 0 to 1 counted 0.0 s after the continue, transport open again (`framesIn` 7 to 9), page's probe answered; keychain add, edit and remove with no prompt (login keychain `/Users/runner/Library/Keychains/login.keychain-db`; modification date moved after the edit; unattended: yes).
- Windows: one open transport 0.5 s after the switch (`framesIn` 1, `framesOut` 6); the bar `<name> · connected`; the stand-in saw one upgrade with the bearer password and a `hello` (browser, platform desktop, protocol 1), no control answer held the password; 7 processes suspended 15.6 s: `wake` 0 to 1 counted 1.6 s after the resume, bar connected again, ping answered; Credential Manager add, edit, remove with no prompt, target `LegacyGeneric:target=<scope>/<entry id>/password.com.avatsaev.pi-studio`.
- First build and run of the `net` crate (rustls with the platform verifier, ring, socket2), the keychain crates and `if-addrs` on macOS and Windows: all compiled, no extra tool. `cargo test` of `net` was not run on those runners.

## Acceptance criteria
- [x] A run of the workflow is green on both runners with the keychain result and the wake count in the summaries (run 44979817186).
- [x] The script's unit tests pass; the workflow passes `actionlint`.
- [x] A check that cannot run on a runner is skipped with its reason, never silently (the keychain checks and the rehearsal skips use `Skip`; a skip also writes an "unattended: no" fact). None was skipped on the runners.
- [x] `cargo xtask ci` passes.

## Follow-ups / TODO(verify)
- Not shown: the PowerShell suspend text was never run on Linux (only its text and output parsing are tested) — it ran for real on the Windows runner; macOS `security` seeing the item the app wrote — shown on the runner.
- The runs do not look at the `bufferedAmount` pause (checklist M6), a real sleep (M1), an unsigned build after an update (M3), a firewall prompt (M5).
- Spec edited by the orchestrator: keychain criterion ticked with runner evidence; TODO(verify) on the runner keychain, the control socket on Windows, the builds on both runners.
