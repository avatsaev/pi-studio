# Platform checks (macOS and Windows)

The app was built and tested on Linux. On macOS (WKWebView) and Windows (WebView2) only the
automated checks of the last section have run, on GitHub's runners (2026-11-20, pull request #59):
the items they cover are marked there. Everything else on this page is for a person with one of
those machines, in under an hour, and the table at the end is where the results go. Each item has
steps and the result to expect.

## Get the app

1. On GitHub, run the **Desktop release** workflow on the branch by hand (Actions → Desktop release → Run workflow). A manual run builds the installers as workflow artifacts and publishes nothing.
2. Download the artifact for the machine (a `.dmg` for macOS, an `.msi` or the NSIS `.exe` for Windows).
3. The installers are not signed. **macOS:** open the app once, then allow it in System Settings → Privacy & Security ("Open Anyway"). **Windows:** SmartScreen says "Windows protected your PC": More info → Run anyway.
4. For every item below, start the app with a scratch configuration directory so it does not touch your own: `--config-dir <dir>` (macOS: `open -a "Pi Studio" --args --config-dir /tmp/pi-check`; Windows: `"Pi Studio.exe" --config-dir C:\pi-check`). A daemon to connect to: on the same machine, `npm i -g @av-pi-studio/cli` then `pi-studio daemon start` (macOS), or a daemon on another machine reached by address (Windows has no local daemon).

Items marked **automated** are also run by the workflow `desktop-platform-checks.yml` (see the last section); a person need not repeat them.

## Native host

| # | Item | Steps | Expected |
|---|---|---|---|
| N1 | Starts, connects, restores | Start the app, enter a daemon address (or use the local entry on macOS), connect, open a workspace, split a pane, quit, start again | The window draws the workbench; connects; the split pane is back. The configuration directory (default: macOS `~/Library/Application Support/com.avatsaev.pi-studio`, Windows `%APPDATA%\com.avatsaev.pi-studio`; write down what you see) holds `settings.json`, `daemons.json` and `daemon-state\*.json` and nothing else of the app's (plus `secrets.json` only when the app fell back to its file store, R4) |
| N2 | Keyboard | In the composer: copy, paste, select all, cut, undo; then quit with the platform's shortcut (`Cmd+Q` / `Alt+F4`) | Each works; on macOS the Edit menu's items do the same; the app quits |
| N3 | Upload button | Files panel → Upload | The operating system's file picker opens; a chosen file uploads. If nothing opens, report it: the app then needs a native picker command (spec TODO) |
| N4 | Drag from the file manager | Drag a file from Finder or Explorer onto the Files panel | It uploads. Report separately if the cursor shows "not allowed" |
| N5 | Native confirm and alert | Delete a file in the Files panel | A native, modal confirm over the window: text names the file; Cancel keeps the file |
| N6 | Download | Download a file of at least 1 GiB (Files → context menu → Download) | A native save dialog (starting in Downloads); the file is byte-identical (`shasum -a 256` / `Get-FileHash`); memory stays flat; cancelling the dialog leaves no file and no `.pistudio-save-*.part` |
| N7 | External link | Click an `https` link in a chat message | The default browser opens it; the window stays on the workbench. A `file:` or `javascript:` link opens nothing |
| N8 | Second launch | Start the app while it runs | The first window is focused; there is still one `Pi Studio` process |
| N9 | Close during a transfer | Start a large upload or download, close the window | A native confirm: "N file transfer(s) are still running. Quit anyway?"; No keeps the app and the transfer |
| N10 | Layout just before closing | Split a pane, close the window within a second, start again | The split is back. (On Linux a change in the last ~250 ms was lost: record what you see) |
| N11 | HTML preview probe | Follow `swe/notes/desktop-preview-origin-spike.md`: open an HTML file with an inline script in the preview | Write down **origin** if the script ran and the isolation attempts (parent, storage, command channel, popup) all failed; **inert** if the script did not run. Then say which platform; the app's table (`crates/shell` preview kind) follows this result |
| N12 | Copy to the clipboard | Files → context menu → Copy Absolute Path, paste into another app | The path is pasted |

## Daemon registry

| # | Item | Steps | Expected |
|---|---|---|---|
| R1 | Launch without a terminal (macOS) | Install the CLI with a Node version manager (nvm, fnm, volta) or Homebrew, so only the shell's start-up files put it on `PATH`; start the app from the Dock or Launchpad | The local entry is `stopped` or `running`, not "CLI not found"; with auto-start on, the workbench connects. Write down the login shell (`echo $SHELL`) and the manager |
| R2 | No CLI | Rename the CLI away or set `cliPath` to a missing file, restart | The Daemons screen opens with the reason; for a missing CLI, the install command `npm i -g @av-pi-studio/cli`; adding a direct entry and connecting still works |
| R3 | Native Daemons menu | Menu bar → Daemons | It lists the entries with the current one checked, "Manage Daemons…", then Start / Stop / Restart Local Daemon enabled as the state says; choosing another entry reloads and connects; on macOS the Edit menu still has Copy, Paste, Select All |
| R4 | Secret store and `daemons.json` | Without `--secret-store`, add a direct entry with a password and a relay entry with a pairing link, then edit the password, then remove both. After each step list the keychain: macOS Keychain Access (search `com.avatsaev.pi-studio`; the account is `<scope>/<entry id>/password` or `/pairingLink`) or `security find-generic-password -s com.avatsaev.pi-studio`; Windows Credential Manager → Windows Credentials (`cmdkey /list` shows the entries). Note any prompt (an unsigned build may ask for the login keychain's password) and whether the page then said the keychain was not used. Then start with `--secret-store file` and a fresh `--config-dir` and add a password | In the keychain run: the Daemons screen has no "kept in a file" line; one item appears per add, changes on the edit and goes on the remove; `daemons.json` (macOS `stat -f %Lp daemons.json`) is mode `600`, has `"version": 2`, `hasPassword` and neither the password nor the link; no log line holds either. In the file run: the Daemons screen says passwords and pairing links are kept in a file only this user can read, `secrets.json` is in the directory (macOS mode `600`), the keychain gets no item. Linux has shown both (`swe/features/desktop-transport-bridge.md` § Acceptance criteria, Secrets); a prompt, an unsigned build's access and Windows' file mode were not examined |
| R5 | Quit keeps the daemon | Start the local daemon from the app, quit the app | `pi-studio daemon status` still says it is up (macOS) |
| R6 | Switch during a transfer | Start a download, choose another entry in the menu or the switcher | A native confirm; No leaves the connection and the transfer |
| R7 | Windows: no local daemon | Open the Daemons screen | The local entry explains that it is not supported on Windows and offers no Start; `daemon.local.start` over the control socket answers `unsupported` |
| R8 | Windows: daemon in WSL2 | Start `pi-studio daemon start` inside WSL2 and add a direct entry `ws://127.0.0.1:6767` | It connects (expected, untried) |

## Milestone 2: the daemon connection in Rust

Since milestone 2 the socket to the daemon of a `local` or `direct` entry is Rust's: the page connects to a single-use `ws://127.0.0.1:<port>/<token>` that the app opens for it (`swe/features/desktop-transport-bridge.md`, decision T5), and the secrets are in the operating system's keychain. A `relay` entry keeps the webview's own socket. Each step is marked **automated** (a run on a machine needs no person) or **manual**; the third column says what to expect. Start the app as in "Get the app", with `--control <port> --control-token-file <file>` so that `ui.inspect` shows `connection` (`transports`, `lastError`, `resumeSignals`, `secretStore`; `docs/control-protocol.md`).

| # | Item | Steps | Expected |
|---|---|---|---|
| M1 | Sleep five minutes with a session open (**manual**, each machine: macOS, Windows, and a Linux desktop) | Connect to a daemon (a direct entry with a password; the daemon on another machine or reached by address) and open a terminal that prints a line every second. Type a draft into the composer without sending it. Note `connection.resumeSignals.wake` from `ui.inspect`. Put the machine to sleep for five minutes (Apple menu → Sleep; Start → Power → Sleep; the suspend command), wake it, and watch the connection bar without touching the window | The bar is `connected` within 10 s of the wake (it may pass through `disconnected` and `connecting…` first); the draft and the terminal's scroll-back are still there (no reload); `resumeSignals.wake` is one higher (a system sleep moves the wall clock only; if it did not rise, record that: the recovery then came from the page's own triggers, the window becoming visible or the `online` event); `transports` lists one `open` entry and `lastError` may name `upstream_lost` for the old connection. Write down the seconds from the wake to `connected` and whether the tick still ran while macOS napped a hidden app (a stalled tick looks like a wake: harmless). Repeat once with a `relay` entry: it uses the webview's own socket and the page's own triggers |
| M2 | The keychain item, on a build that has the keychain (**manual**, macOS and Windows) | As R4, without `--secret-store`: add a direct entry with a password, edit the password, clear it, set it again, remove the entry, then add a relay entry with a pairing link and remove it. After each step look for the item (macOS: Keychain Access, search `com.avatsaev.pi-studio`, or `security find-generic-password -s com.avatsaev.pi-studio -a "<account>" -w`; Windows: Credential Manager → Windows Credentials, or `cmdkey /list`); the account is `<scope>/<entry id>/password` or `/pairingLink` and the scope is 16 hex digits of a hash of `--config-dir` (`default` without it) | The item appears on add, its value changes on edit, goes on clear, returns, and goes on remove, and `daemons.json` never holds a secret; `ui.inspect` says `secretStore: "keychain"`. Linux was shown on 2026-11-22 (see below) |
| M3 | An unsigned macOS build after an update (**manual**, macOS) | Install build A, add a direct entry with a password, connect, and answer the keychain prompt "Always Allow". Quit, install a later build B over it (the artifact of another run of the desktop workflow), start it and connect to the same entry. Then do it once more answering "Deny" | Expected from the spec: the keychain asks again after the update, because the item is bound to the signature of the build that wrote it and every unsigned build has a different one; accepted until signing (milestone 5). Write down the exact prompt, how many there were (one per item), and whether "Always Allow" survived the update. A "Deny" gives `secret_unavailable`: the bar shows the message and Retry asks again |
| M4 | A daemon behind an HTTP proxy (**manual**, any machine; P6) | Set the system's HTTP proxy to one that reaches a daemon the machine cannot reach otherwise (or to a dead end), add a direct entry for that daemon and connect; then open the same address in the system browser | The browser reaches the daemon through the proxy; the app does not: Rust's sockets ignore the proxy settings, so the bar says the connection was refused or unreachable (`unreachable`; the tooltip names the host and port). This is a known difference from milestone 1, where the webview's own socket used the proxy. Not run on any machine yet |
| M5 | A firewall or endpoint-security prompt (**manual**, macOS and Windows, with the system firewall on and, if one is installed, an endpoint-security product) | Start the app for the first time on a machine whose firewall is on, connect to a daemon, reload the page twice | The spec expects no prompt: the app listens on `127.0.0.1` for a few milliseconds per connection and the page connects there. Write down any prompt (macOS: "Do you want the application to accept incoming network connections?"; Windows: "Allow Pi Studio to communicate on these networks"), its exact text, and what choosing Block does: a blocked loopback leg shows as `local_connection` in the connection bar ("the app could not open its own local connection") and `lastError` `page_timeout` |
| M6 | An upload paused on `bufferedAmount` (**manual**, Windows through WebDriver; macOS has no driver, so n/a there) | With the WebSocket recorder of `docs/development.md` § The resume signals through the proxy installed (it samples the page's socket's `bufferedAmount` every 100 ms), upload a 1 GiB file with the Upload button, stop the daemon process for 6 s in the middle (`kill -STOP`, `Suspend-Process`), then continue it. Compare the downloaded copy's hash with the file's | `bufferedAmount` climbs to about 1 MiB and the SDK's upload waits there (it resumes at 256 KiB); Rust's `peakHeldOut` in `ui.inspect` stays at or under 1 MiB; the upload finishes after the continue and both copies have the same hash. **Linux did not show the pause** (2026-11-22): WebKitGTK passes the bytes to its network process, `bufferedAmount` stayed under 33 KB and that process grew by about 890 MiB during the stall, so the clause is answered by a Windows or macOS run only |
| M7 | The proxied connection on a runner (**not automated**) | The workflow's scripts do not read `connection` from `ui.inspect` and do not connect to a daemon through the proxy; they run with `--secret-store=file` and the Windows job drives the page without a daemon connection | Nothing of this section runs on a runner yet. The proxy is covered by the `pistudiodesktop-net` tests and by the Linux run below |

What the Linux run showed (2026-11-22, the real WebKitGTK webview in `pi-desktop-xvfb`, scratch directories and free ports only; the procedure is `docs/development.md` § The resume signals through the proxy). A person with a Linux desktop still runs M1 once.

| Check | Observed |
|---|---|
| Processes stopped 30 s, daemon restarted with `kill -9` at +8 s | `resumeSignals.wake` 0 to 1; the page's old socket closed 1006 at +38 ms and a second one, on another port with another token, opened at +95 ms; the bar went `connected`, `disconnected` (+43 ms), `connecting…` (+46 ms), `connected` (+100 ms); `transports` had one `open` entry; `lastError` `upstream_lost` (the old connection); `performance.timeOrigin`, the marker and the history length unchanged (no reload) |
| Daemon frozen (`kill -STOP`) while the app was stopped 30 s, the daemon continued 12 s after the app | `wake` 1 to 2; the page's `ping` went out at +44 ms and no `pong` came; the bar changed to `disconnecting…` at +5.05 s (the 5 s limit), the socket closed with 4000 at +7.05 s (Rust waits up to 2 s for the frozen daemon's close answer), `connecting…` at +7.5 s; the daemon continued at +12.06 s and the new socket was open at +12.11 s, `connected` at +12.12 s (6 ms after the daemon continued). `transports` went `open`, `closing`, none, `connecting`, `open`: never two |
| An address added with a dummy interface, session open | `network` 0 to 1; the page sent one `ping` 4.96 s after the address was added (the 5 s reading, the 1 s settling and the resume limit) and got its `pong` 3 ms later; no new socket, no change in the bar, the same transport (`framesIn` and `framesOut` rose by one); removing the address and the interface gave another event, another `ping` and `pong`, and again no reconnect |
| A version 1 `daemons.json` (a direct entry with a password, a relay entry with a pairing link), `--secret-store=file` | Version 2, mode 600, `hasPassword` true on the direct entry only, neither secret in the file; `secrets.json` mode 600 held `<id>/password` and `<id>/pairingLink`; no `.corrupt-*` copy; `ui.inspect` `secretStore` `file`; the direct entry showed `connected` with one `open` transport; the relay entry, chosen in the switcher, showed `connected` with `transports` `[]` and the relay logged a paired connection; no control reply held either secret |
| The keychain backend (`pi-desktop-keyring`, GNOME Keyring, no `--secret-store`) | `secretStore` `keychain`; `secret-tool search --all service com.avatsaev.pi-studio` showed the password item (`<scope>/<id>/password`) appear on add, change on edit, go on clear, return on set and go on remove, the link item (`/pairingLink`) appear and go the same way; a rename changed nothing; `daemons.json` held no secret and no `secrets.json` was made |
| `cargo test -p pistudiodesktop-shell --test secret_guard` | 1 passed: no control answer, event or log line holds a password, a pairing link or the proxy token (the token marker sits in the connection view's hook and appears in no answer) |

### Results (milestone 2)

One row per machine. Mark M1 to M7 pass, fail (with what was seen) or n/a; write the wake-to-connected seconds for M1 and the prompts for M3 and M5.

| Date | Machine and OS | Webview | M1 (seconds to connected) | M2 | M3 (prompts) | M4 | M5 (prompt text) | M6 | Who |
|---|---|---|---|---|---|---|---|---|---|
| | macOS arm64 | | | | | | | | | |
| | macOS x64 | | | | | | | | | |
| | Windows | | | | | | | | | |
| | Linux desktop | | | | | | | | | |

## Results

Fill one row per machine and pass. Mark each item pass, fail (with what you saw) or n/a.

| Date | OS and version | Webview | Items passed | Items failed (what was seen) | Preview probe (origin / inert) | Who |
|---|---|---|---|---|---|---|
| | | | | | | |

## The automated workflow

`.github/workflows/desktop-platform-checks.yml` builds a debug app on a Windows and a macOS runner and runs the checks a machine can run (`apps/pistudiodesktop/scripts/platform-checks.mjs`). Until the workflow file is on `main`, GitHub offers no manual run for it (`gh workflow run` answers 404 "not found on the default branch"): it runs on a pull request that changes the workflow file (`gh run watch` follows it). Once it is on `main`: Actions → Desktop platform checks → Run workflow, or `gh workflow run desktop-platform-checks.yml --ref <branch>`. It never runs on a push to `main` and publishes nothing. **Read the job summary first:** it holds the printed facts (the Windows preview probe, the macOS configuration directory, where `daemons.json` is, the first daemon start's duration, which shells found the CLI). Screenshots and logs are the `platform-checks-<os>` artifacts.

### First results (run 44835263318, 2026-11-20, commit 5751855)

| Runner | Result |
|---|---|
| macOS 15.8.2, arm64 (WKWebView, control socket only) | 14 passed, 0 failed |
| Windows Server, WebView2 157.0.4341.46 (WebDriver through msedgedriver) | 10 passed, 0 failed |

Facts the runs printed:

- **Windows preview probe:** the app's preview kind is `inert`; `preview_mount` is refused ("scripts in previews are not supported on this platform") and the page's sandboxed `srcdoc` frame blocks scripts. Whether `origin` would work on WebView2 was **not** measured: it needs an app change (a debug switch), so N11 stays manual.
- **macOS configuration directory:** `~/Library/Application Support/com.avatsaev.pi-studio` (as documented; the run had a scratch `HOME`).
- **Windows `daemons.json`** is in the `--config-dir` given to the app (the run's scratch directory); the default Windows directory was not printed.
- **Local daemon on macOS:** the CLI was found through the login shell's start-up file alone under zsh (`~/.zprofile`) and bash (`~/.bash_profile`); `daemon.local.start` took 3.5–3.8 s to `running`; quitting the app left the daemon running; `daemons.json` was mode 0600 and no answer or log line held the password; a CLI reporting 0.0.118 gave `cli_outdated`.
- **Cold CLI:** the real CLI's first `--version` on a runner took 2.4 s (the app allows 5 s). In an earlier run it took longer than 5 s once, and the app showed `failed`/`timeout`; the check now runs the CLI once first and prints that time. Locally it takes 0.34 s.
- **Windows needs a machine policy on a GitHub runner.** WebView2 150 and later ignores `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` when the app runs elevated, and runners run everything elevated, so msedgedriver could not open its debugging port ("DevToolsActivePort file doesn't exist"). The workflow writes `HKLM\SOFTWARE\Policies\Microsoft\Edge\WebView2\AdditionalBrowserArguments` for `pistudiodesktop.exe` (see the step's comment). A non-elevated user session is not expected to need it (Microsoft's hardening is for elevated hosts; not tried). msedgedriver also turns each `args` entry into a browser switch, so the app is given `--config-dir=<dir>` as one argument.
- `tauri-driver --version` exits 1 (the summary shows `tauri-driver not available (1)`), but the sessions go through `tauri-driver`: the app's output reaches the run's log. The version line is cosmetic.

The negative controls were done: a deliberately wrong expectation turned the Windows job red on exactly that check (run 44833729601), and with the shell-environment lookup removed from the app, the macOS `cli-found` checks went red with `cli_missing` (run on Linux with bash against the real CLI, then reverted).

### What it covers, so that a person can skip those items

| Item | Automated on |
|---|---|
| N1 starts and restores (storage written within 2 s and back after a restart) | Windows: `windows.boot`, `windows.storage-persist`, `windows.storage-restart`; macOS: `macos.control.start`, `macos.control.settings-write` (control socket, no page) |
| N1 configuration directory | macOS: `macos.config-dir` prints it |
| N5/N7 partly: an unlisted command and an off-origin navigation are refused | Windows: `windows.command-refused`, `windows.navigation-refused` |
| N8 second launch leaves one process | Windows: `windows.single-instance` |
| N11 preview probe | Windows: `windows.preview-probe` prints that scripts are blocked in the `inert` fallback; `origin` is not measured, N11 stays manual |
| R1 (the mechanism) CLI found with only the login shell's start-up file | macOS: `registry.macos.cli-found.zsh`, `registry.macos.cli-found.bash` (an emptied environment; a launch from the Dock is still manual) |
| R4 secret store and `daemons.json` | macOS: `registry.macos.direct-entry` (mode 0600, no password in answers), `registry.macos.no-secret-in-log`; Windows: `registry.windows.daemons-json` prints the location. The scripts start the app with `--secret-store file`, so they never touch a keychain: the keychain half of R4 is manual |
| R5 quit keeps the daemon | macOS: `registry.macos.quit-leaves-daemon` (also `registry.macos.daemon-start`, `-health`, `-stop`; `macos.control.quit` quit through System Events and passed) |
| R7 no local daemon on Windows | Windows: `registry.windows.local-unsupported` |
| Registry switching | Windows: `registry.windows.switch` (two direct entries, each keeps its layout, same theme) |
| An outdated CLI | macOS: `registry.macos.cli-outdated` (the fake CLI, 0.0.118) |

Still manual: N2–N4, N6, N9, N10, N12 (keyboard, pickers, drags, native dialogs, the clipboard), R2, R3 (native menus have no driver), R6, R8, and the macOS Dock launch of R1.
