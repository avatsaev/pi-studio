# Platform checks (macOS and Windows)

The app was built and tested on Linux. Nothing in it has run on macOS (WKWebView) or Windows
(WebView2). This page is the list a person with one of those machines runs, in under an hour,
and the table at the end where the results go. Each item has steps and the result to expect.

## Get the app

1. On GitHub, run the **Desktop release** workflow on the branch by hand (Actions → Desktop release → Run workflow). A manual run builds the installers as workflow artifacts and publishes nothing.
2. Download the artifact for the machine (a `.dmg` for macOS, an `.msi` or the NSIS `.exe` for Windows).
3. The installers are not signed. **macOS:** open the app once, then allow it in System Settings → Privacy & Security ("Open Anyway"). **Windows:** SmartScreen says "Windows protected your PC": More info → Run anyway.
4. For every item below, start the app with a scratch configuration directory so it does not touch your own: `--config-dir <dir>` (macOS: `open -a "Pi Studio" --args --config-dir /tmp/pi-check`; Windows: `"Pi Studio.exe" --config-dir C:\pi-check`). A daemon to connect to: on the same machine, `npm i -g @av-pi-studio/cli` then `pi-studio daemon start` (macOS), or a daemon on another machine reached by address (Windows has no local daemon).

Items marked **automated** are also run by the workflow `desktop-platform-checks.yml` (see the last section); a person need not repeat them.

## Native host

| # | Item | Steps | Expected |
|---|---|---|---|
| N1 | Starts, connects, restores | Start the app, enter a daemon address (or use the local entry on macOS), connect, open a workspace, split a pane, quit, start again | The window draws the workbench; connects; the split pane is back. The configuration directory (default: macOS `~/Library/Application Support/com.avatsaev.pi-studio`, Windows `%APPDATA%\com.avatsaev.pi-studio`; write down what you see) holds `settings.json`, `daemons.json` and `daemon-state\*.json` and nothing else of the app's |
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
| R4 | `daemons.json` | Add a direct entry with a password | The file is in the configuration directory; on macOS `stat -f %Lp daemons.json` prints `600`; no log line holds the password |
| R5 | Quit keeps the daemon | Start the local daemon from the app, quit the app | `pi-studio daemon status` still says it is up (macOS) |
| R6 | Switch during a transfer | Start a download, choose another entry in the menu or the switcher | A native confirm; No leaves the connection and the transfer |
| R7 | Windows: no local daemon | Open the Daemons screen | The local entry explains that it is not supported on Windows and offers no Start; `daemon.local.start` over the control socket answers `unsupported` |
| R8 | Windows: daemon in WSL2 | Start `pi-studio daemon start` inside WSL2 and add a direct entry `ws://127.0.0.1:6767` | It connects (expected, untried) |

## Results

Fill one row per machine and pass. Mark each item pass, fail (with what you saw) or n/a.

| Date | OS and version | Webview | Items passed | Items failed (what was seen) | Preview probe (origin / inert) | Who |
|---|---|---|---|---|---|---|
| | | | | | | |

## The automated workflow

`.github/workflows/desktop-platform-checks.yml` builds a debug app on a Windows and a macOS runner and runs the checks a machine can run (`apps/pistudiodesktop/scripts/platform-checks.mjs`). Until the workflow file is on `main`, GitHub offers no manual run for it (`gh workflow run` answers 404 "not found on the default branch"): open a pull request from the branch (it runs on a pull request that changes the workflow file; `gh run watch` follows it). Once it is on `main`: Actions → Desktop platform checks → Run workflow, or `gh workflow run desktop-platform-checks.yml --ref <branch>`. It never runs on a push to `main` and publishes nothing. **Read the job summary first:** it holds the printed facts (the Windows preview probe, the macOS configuration directory, where `daemons.json` is, the first daemon start's duration, which shells found the CLI). Screenshots and logs are the `platform-checks-<os>` artifacts. Nothing in it has run on a runner yet: the first run settles the `TODO(verify)` comments at the top of `windows.mjs` and `macos.mjs`.

What it covers, so that a person can skip those items:

| Item | Automated on |
|---|---|
| N1 starts and restores (storage written within 2 s and back after a restart) | Windows: `windows.boot`, `windows.storage-persist`, `windows.storage-restart`; macOS: `macos.control.start`, `macos.control.settings-write` (control socket, no page) |
| N1 configuration directory | macOS: `macos.config-dir` prints it |
| N5/N7 partly: an unlisted command and an off-origin navigation are refused | Windows: `windows.command-refused`, `windows.navigation-refused` |
| N8 second launch leaves one process | Windows: `windows.single-instance` |
| N11 preview probe | Windows: `windows.preview-probe` — the app's preview kind is `inert` there, so the probe runs in a `srcdoc` frame and prints "scripts blocked"; whether `origin` would work needs an app change (a debug switch), so N11 stays manual |
| R1 (the mechanism) CLI found with only the login shell's start-up file | macOS: `registry.macos.cli-found.zsh`, `registry.macos.cli-found.bash` (an emptied environment; a launch from the Dock is still manual) |
| R4 `daemons.json` | macOS: `registry.macos.direct-entry` (mode 0600, no password in answers), `registry.macos.no-secret-in-log`; Windows: `registry.windows.daemons-json` prints the location |
| R5 quit keeps the daemon | macOS: `registry.macos.quit-leaves-daemon` (also `registry.macos.daemon-start`, `-health`, `-stop`; `macos.control.quit` is skipped if the runner refuses Command-Q) |
| R7 no local daemon on Windows | Windows: `registry.windows.local-unsupported` |
| Registry switching | Windows: `registry.windows.switch` (two direct entries, each keeps its layout, same theme) |
| An outdated CLI | macOS: `registry.macos.cli-outdated` (the fake CLI, 0.0.118) |

Still manual: N2–N4, N6, N9, N10, N12 (keyboard, pickers, drags, native dialogs, the clipboard), R2, R3 (native menus have no driver), R6, R8, and the macOS Dock launch of R1.

