# Grill — Desktop native shell (milestone 1)

> Status: grilling
> Started: 2026-11-15   Last updated: 2026-11-15   Rounds: 4
> Engineer: avatsaev   Agent: Claude (omp)

## Raw idea

"let's have a short grill for 1", where 1 is milestone 1 of `docs/desktop-client-handoff.md`
§ Suggested milestones, as the engineer approved it:

> **Finish the native host.** Tauri-backed dialogs, external links in the system browser, save to
> disk, native file picker and drag-and-drop, storage. The sample Rust engine is removed. The HTML
> preview gets its own origin.

and, from "ok fold in A":

> **Local daemon supervision (option A).** The app does not bundle a daemon. It finds an installed
> `pi-studio` CLI on `PATH` and drives it with `pi-studio --json daemon start|stop|restart`, shows
> the daemon's state, and connects to it; with no CLI it explains how to install it.

## Codebase context

| Area | Path(s) | Fact that matters |
|------|---------|-------------------|
| Desktop frontend | `desktop/apps/pistudiodesktop/src/main.tsx` | Mounts `<Workbench>` with `createBrowserHost()` and `platform: "desktop"`; no desktop host exists yet |
| Host contract | `packages/workbench/src/host/types.ts` | Members: `app`, `storage` (synchronous `get`/`set`), `clipboard`, `dialogs` (`confirm`/`alert`/`prompt`), `links.openExternal?`, `launch`, `connection` (`createTransport`, `timers`, `onResume`), `files` (`upload`, `saveToDisk`, `openForView`, `pickUploads?`), `pdf?` |
| Browser host | `packages/workbench/src/host/browser-*.ts` | `saveToDisk` downloads into a `Blob` and clicks a download anchor; `onResume` listens to `visibilitychange` and `online`; dialogs are `window.confirm/alert/prompt`; no `openExternal`, so links use `target="_blank"` |
| Dialog use | `packages/workbench/src` | 27 `dialogs.*` call sites; one `dialogs.prompt` (session rename, `features/sessions/session-actions.ts`). Tauri's dialog plug-in has no text prompt |
| Stored state | `lib/pane-layout-persistence.ts`, `features/chat/todos/agent-todos-store.ts`, the UI store behind `ConnectionBar` | Pane layout, panel state, the daemon address and the password all go through `host.storage` (the webview's `localStorage` today) |
| OS file drops | `features/files/FileExplorer.tsx`, `features/chat/Composer.tsx`, `features/workspace/external-drag.ts` | Upload-by-drop and the Files-tree-to-composer drag use HTML5 drag and drop (`dataTransfer`). Tauri's `dragDropEnabled` defaults to true, which per its documentation blocks HTML5 drops on Windows (not tested here) |
| HTML preview | `features/files/html-sandbox.ts` | A sandboxed `srcdoc` frame; it inherits the window's Content-Security-Policy, so its scripts do not run in the desktop app (measured in Chromium and WebKitGTK) |
| CLI daemon control | `packages/cli/src/daemon-commands.ts` | `pi-studio --json daemon status` prints `{up, host, port}`; `start`/`restart` print `{up, started, host, port, pairingUrl, relay}` or `error: "not_healthy" \| "no_keypair"`; `stop` prints `{stopped}`. `start` on a running daemon reports `started: false` |
| Versions | `packages/protocol/src/messages.ts` | `server_info` carries an optional `version` and the feature flags; `hello` carries an optional `appVersion` |
| Rust side | `desktop/crates/{doc,ops,format,engine,shell}`, `apps/pistudiodesktop/src-tauri/src` | The template's sample: a checklist model, undo, a file format, a command registry, a control socket, and two Tauri commands plus one event that the frontend no longer calls. Only `tauri-plugin-dialog` is installed |
| Webview policy | `apps/pistudiodesktop/src-tauri/tauri.conf.json`, `capabilities/default.json` | A strict policy and `core:default` only; any Tauri call from the frontend needs a capability entry |
| Platforms | `.github/workflows/desktop-release.yml` | Linux is verified locally; macOS and Windows builds have not run yet. The daemon is POSIX-only |

## Problem & outcome
- **Who:** someone who uses Pi Studio every day, often with more than one daemon (this machine, a
  server, a paired remote one).
- **Today:** the desktop window is the web client in a frame. It asks for an address and a
  password each time it meets a new daemon, uses the webview's dialogs, downloads and storage, and
  knows nothing about the daemon on this machine. Its Rust side is a sample checklist app.
- **Done means:** the app opens on the daemon used last, starting this machine's daemon when
  needed; daemons are kept in a registry and switched from the native menu; dialogs, links, saving
  a file and settings are native; the sample is gone.
- **Measured by:** the acceptance criteria below, on Linux, macOS and Windows.

## Goals
- A daemon registry owned by Rust: add, rename, remove and switch daemons (D8, D12–D17).
- Local daemon supervision through an installed `pi-studio` CLI: start, stop, restart, state
  (D3, D4, D10, D11).
- A desktop host for the workbench: settings in a Rust-owned file, native confirm and alert,
  external links in the system browser, save to disk through a native dialog, a native file
  picker for uploads (D1, D9).
- The HTML file preview runs scripts again, from an origin of its own (D7).
- The template's checklist sample is deleted; the command registry, control socket and CLI stay
  and carry the app's real commands (D2).

## Non-goals
- Sockets in Rust, the OS keychain, reconnect on sleep and wake: milestone 2.
- Large-file transfer performance, resume, native drops with file paths: milestone 3.
- The relay in Rust: milestone 4. Relay entries use the workbench's existing relay transport.
- Several windows, or several daemons connected at once (D16).
- Bundling a daemon; a daemon on Windows; several local daemons with other home directories (D12).
- Signing, the updater, notifications, a tray icon: milestone 5.

## Happy path
1. First launch on macOS or Linux with the CLI installed. The registry holds one entry, "This
   machine". The app finds the CLI (D10), runs `pi-studio --json daemon start`, and connects to
   the address it reports. The workbench appears, connected.
2. The user opens the Daemons screen from the switcher in the connection bar, adds a server by
   address and password, and adds a second one by pasting a pairing link. Each gets a name.
3. The user picks the server in the native menu. The app disconnects, connects to the server, and
   shows that daemon's own layout.
4. The user quits. The local daemon keeps running (D4).
5. Next launch opens on the server, the daemon used last (D17).
6. Along the way: deleting a file asks through a native dialog, a link in a message opens in the
   system browser, "Download" opens a native save dialog, renaming a session uses an in-app
   dialog, and an HTML file's preview runs its scripts.

## Decisions
| # | Theme | Question | Decision | Rationale | Round |
|---|-------|----------|----------|-----------|-------|
| D1 | data & state | Where does the app's own state live? | Settings (address, pane layout, panel state, everything behind `host.storage`) move to a file owned by Rust in this milestone. The password stays in the webview's storage until milestone 2 moves it to the OS keychain with the transport | Survives a webview data reset and is readable by the Rust side; the keychain belongs with the code that sends the password | 1 |
| D2 | scope | What happens to the template's sample Rust engine? | Delete the checklist (`doc`, `ops`, `format` crates and the `item.*`/file commands). Keep the command registry, the control socket and the CLI, now holding the app's real commands (e.g. `daemon.start`) | Keeps the app scriptable and testable without a window; removes what has no use | 1 |
| D3 | happy path | What does the app do on launch when the CLI is installed? | Start the local daemon if it is not running, then connect to it. A setting turns this off | A desktop app should open ready to use | 1 |
| D4 | happy path | What happens to a local daemon on quit? | It is always left running. Stopping it is an explicit action in the app | Agents, schedules and loops run inside the daemon; the CLI behaves the same way | 1 |
| D5 | dependencies | The installed CLI or daemon is older or newer than the app | Connect anyway, gate features on the daemon's feature flags, and show a non-blocking notice when the daemon is older than the app needs | Feature flags already describe what a daemon can do; refusing would lock a user out over a minor mismatch | 1 |
| D6 | integration | OS file drops onto the window | Turn Tauri's own drop handling off, so HTML5 drops work as in the browser. Native drops with file paths wait for milestone 3 (the transfer engine) | Same code path as the web client; file paths only pay off once Rust does the upload | 2 |
| D7 | integration | HTML file preview (scripts blocked by the window's policy) | In this milestone: a short spike on the three webviews, then serve the preview from an origin of its own through a new optional host member. A platform whose webview cannot do it shows "scripts are disabled in the desktop app" | The engineer wants it fixed now; the fallback keeps the milestone from blocking on one webview | 2 |
| D8 | scope | Where does daemon control live? | **A daemon registry in the Rust app** (engineer's own answer): the user adds several daemons, manages them, and switches between them from the native menu. Supersedes "one control in the connection bar". Details are round 3 | The engineer works with more than one daemon | 2 |
| D9 | integration | Dialogs | Native OS dialogs for confirm and alert. Session rename becomes an in-app dialog in the workbench, for the web client too | Tauri has no native text prompt; one rename dialog for both clients | 2 |
| D10 | dependencies | Finding the `pi-studio` CLI | Ask the user's login shell where it is, then try common install locations; a setting holds an explicit path | An app started from the dock does not get the shell's `PATH` (nvm and other version managers) | 2 |
| D11 | scope | Windows, where there is no local daemon | Show the local-daemon entry with a one-line explanation ("a local daemon needs macOS, Linux or WSL") and the way to connect to a remote one | Explains the gap instead of hiding it | 2 |
| D12 | data & state | What can a registry entry be? | Three kinds: this machine's daemon (found through the CLI; Start / Stop / Restart), a direct address (`host:port`, optional password), a relay pairing link. Not: several local daemons with other home directories | Covers the three ways the workbench connects today | 3 |
| D13 | data & state | Where are a daemon's secrets kept? | In the registry file, readable by the user only (mode 0600), until milestone 2 moves them to the OS keychain. **Replaces the password half of D1**: the password no longer stays in the webview's storage | The daemon keeps its own key file the same way; the keychain comes with the transport | 3 |
| D14 | integration | Where are daemons added, renamed and removed? | A "Daemons" screen drawn by the workbench when the host offers a registry member; the web client's host does not, so it never shows it. The native menu lists the daemons for switching | One design system; a native menu cannot hold a form | 3 |
| D15 | integration | What does the connection bar show in the desktop app? | The current daemon's name and status, as a switcher. The address and password fields move into the Daemons screen | The registry replaces typing an address each time | 3 |
| D16 | scope | Switching daemons | One window, one daemon at a time: switching disconnects and connects to the other, and each daemon restores its own layout. A window per daemon is a later milestone | The workbench holds one connection; several at once touches all stored state | 3 |
| D17 | happy path | Which daemon opens on launch? | The last one used. On first run, the local daemon, started if needed (D3) | Returns the user to where they were | 3 |
| D18 | failure | The local daemon cannot be started on launch (CLI missing, or `not_healthy`) | Open the Daemons screen with the reason, install instructions when the CLI is missing, and Retry. The other daemons stay usable; nothing blocks | A missing local daemon must not lock the user out of remote ones | 4 |
| D19 | failure | The last-used daemon is remote and unreachable at launch | Open on it in the workbench's normal reconnecting state, with the switcher available | The outage is usually short; the user keeps their place | 4 |
| D20 | failure | The settings or registry file is unreadable or corrupt | Start with defaults, keep the bad file beside it under another name, show a notice | The app always starts; nothing is destroyed | 4 |
| D21 | state | The app is launched a second time | Focus the window already open: one instance | Two instances would overwrite each other's files | 4 |
| D22 | data lifecycle | Removing a daemon | Ask to confirm. If it is the connected one, disconnect and open the Daemons screen. Its stored layout and secret are deleted. The local entry cannot be removed | "Remove" should leave nothing behind | 4 |
| D23 | failure | A pairing link stops working (the daemon's key was rotated) | The entry shows "pairing link no longer valid" with a field for a new link; its name and layout are kept | Re-pairing should not cost the user their layout | 4 |

## Data & state

- **Settings file (D1).** One file owned by Rust holds every key the workbench stores through
  `host.storage`. `host.storage` is synchronous, so the file's content must be in the page before
  the workbench first renders. No existing desktop users, so nothing to migrate. A corrupt file is
  set aside and defaults are used (D20).
- **Secrets (D13).** Passwords and pairing links live in the registry file, not in the webview's
  storage and not in the settings file.
- **Setting "start the local daemon on launch" (D3).** Default on. Stored in the settings file.
- **Setting "path of the `pi-studio` CLI" (D10).** Empty by default (found automatically).
- **Daemon registry (D8, D12, D13).** A file owned by Rust, mode 0600. One entry per daemon: an
  id, a name, a kind (`local` \| `direct` \| `relay`), and for `direct` the address and optional
  password, for `relay` the pairing link. Also which entry was used last (D17).
- **State per daemon (D16).** Each daemon restores its own layout, so what the workbench stores
  through `host.storage` is kept per registry entry. It is kept per entry and not per daemon
  identity because storage is read before a connection exists.
- **Removal (D22).** Removing an entry deletes its stored state and its secret.

## Integration points
| Existing module / service / config | How the feature touches it | Direction | Risk / note |
|------------------------------------|----------------------------|-----------|-------------|
| `packages/workbench/src/host/types.ts` | New optional host members: a daemon registry (list, add, rename, remove, switch, local daemon state and actions) and an origin for the HTML preview. `dialogs.prompt` leaves the contract once rename is in-app | changes | A published package: additive members only, except the prompt removal, which changes the host contract for every host (the browser host and the desktop host are the only two) |
| `packages/workbench` connection bar and a new Daemons screen | Draws a switcher and the Daemons screen when the host has a registry; unchanged otherwise | changes | The web client must look and behave as before (D14, D15) |
| `packages/workbench/src/features/sessions/session-actions.ts` | Session rename becomes an in-app dialog on both clients | changes | The one visible change for web users (D9) |
| `packages/workbench/src/features/files/html-sandbox.ts` | Uses the host's preview origin when there is one | changes | Preview content is untrusted (written by an agent); the separate origin must not weaken the sandbox |
| `packages/cli` (`pi-studio --json daemon status\|start\|stop\|restart`) | The app runs it as a child process and reads one JSON line | consumes | `start` output contains `pairingUrl`, a credential on relay links: never logged. The JSON shape becomes a contract with the app |
| `desktop/crates/*` | `doc`, `ops`, `format` deleted; `engine` and `shell` keep the registry, control protocol and menus with new commands | changes | `cargo xtask layers` and the panic fuzz must follow |
| `desktop/apps/pistudiodesktop/src-tauri` | Tauri commands for the host members, plug-ins (dialog, opener, single instance), a custom scheme for the preview, the native menu | changes | Each needs a capability entry; the policy in `tauri.conf.json` changes for the preview frame |
| `desktop/apps/pistudiodesktop/src` | A desktop host replaces `createBrowserHost()` member by member | changes | The lint rule that bans Tauri imports in this package must allow the host module |
| `server_info` (`version`, feature flags) | Read to decide the "daemon is older" notice | reads | No protocol change (D5) |

## Edge cases & failure modes
| Area | Condition | Decided behavior | Decision |
|------|-----------|------------------|----------|
| dependencies | The CLI is not on the app's `PATH` (installed through nvm or similar) | Login-shell lookup, then common locations, then the explicit path setting | D10 |
| dependencies | Daemon or CLI older or newer than the app | Connect; gate on feature flags; non-blocking notice when older | D5 |
| dependencies | A webview that cannot serve the HTML preview from its own origin | That platform shows "scripts are disabled in the desktop app" | D7 |
| state | A local daemon is already running (started by the CLI) at launch | Adopt it: `daemon start` reports `started: false`, the app connects | D3 |
| state | The app quits while agents run | The daemon keeps running | D4 |
| dependencies | The local daemon cannot be started (CLI missing, `not_healthy`) | Daemons screen with the reason, install instructions, Retry; other daemons usable | D18 |
| dependencies | The last-used remote daemon is unreachable at launch | Open on it, reconnecting, switcher available | D19 |
| dependencies | A pairing link no longer valid | Entry flagged, new link pasted in place, name and layout kept | D23 |
| dependencies | Windows: no local daemon | The local entry explains why and points to remote connection | D11 |
| state | Settings or registry file corrupt | Defaults, bad file kept aside, notice | D20 |
| state | A second launch | Focuses the open window | D21 |
| state | Switching daemons while connected | Disconnect, connect to the other, restore its layout | D16 |
| data lifecycle | Removing a daemon | Confirm; layout and secret deleted; local entry not removable | D22 |
| data lifecycle | Existing data | n/a — no desktop users yet; the web client's storage is untouched | D1 |
| inputs | A malformed address or pairing link when adding a daemon | Rejected in the form by the parsing the connection bar uses today | D14 |
| inputs | Two entries with the same name or the same address | Not decided: see open questions | |
| identity & access | Wrong or missing password for a daemon | The workbench's existing authentication error; the entry stays and its password can be edited | D15 |
| timing | Switching or quitting while a file transfer runs | Not decided: see open questions | |
| scale | n/a — a handful of daemons; the menu lists them all | | |
| observability & ops | Secrets in logs or over the control socket | Never: passwords, pairing links and `pairingUrl` are not logged and not returned by control methods | D13 |

## Non-functional constraints
| Concern | Constraint / decision |
|---------|-----------------------|
| Performance / volume | Launch to a connected workbench must not wait on the CLI longer than its own health check; the window shows while the daemon starts |
| Security & authorization | Secrets in a user-only file (D13). External links open only `http`, `https` and `mailto` URLs (proposed by the agent, to confirm). The webview gets only the capabilities the host members need. The preview origin cannot reach the app's commands |
| Privacy | Nothing leaves the machine; no telemetry |
| Backward compatibility | The web client is unchanged except the in-app rename dialog. New host members are optional |
| Rollout / feature flag | None: the app is unreleased |
| Observability | The control socket lists daemons and the local daemon's state, without secrets |
| Rollback | Revert the commits; no data format has shipped |

## Deferred
- Native file drops with real paths: milestone 3, with the transfer engine (D6).
- The OS keychain for secrets: milestone 2, with the transport (D13).
- Bundling a daemon; a native Windows daemon (`docs/desktop-client-handoff.md` milestone 5).

## Open questions — TODO(verify)
- [ ] Mode 0600 has no direct Windows equivalent: the file lives in the user's profile, which
  other users cannot read by default. Enough until the keychain? — owner: engineer, at scope
- [ ] Which stored keys are per daemon (layout) and which are global (theme, font size)? — owner:
  agent, at scope (list the keys; engineer confirms)
- [ ] Two entries with the same name or address: allow, or refuse? — owner: engineer (proposed:
  names unique, addresses free)
- [ ] Switching or quitting while a transfer runs: ask first, or cancel silently? — owner:
  engineer (proposed: ask)
- [ ] Does the local entry need an optional password (a local daemon can have
  `PI_STUDIO_PASSWORD` set)? — owner: agent, at scope
- [ ] Does a sandboxed frame on a custom scheme run scripts on WebKitGTK, WKWebView and WebView2?
  This is the D7 spike. — owner: agent
- [ ] macOS and Windows builds have never run (PR #57). — owner: agent

## Acceptance criteria (draft)
- [ ] Given the CLI is installed and no daemon runs, when the app launches for the first time,
  then a local daemon is started and the workbench is connected to it without typing anything.
- [ ] Given a local daemon started from the CLI, when the app launches, then it connects to that
  daemon and starts no second one.
- [ ] Given the app is connected to the local daemon with an agent running, when the app quits,
  then the daemon and the agent keep running.
- [ ] Given no CLI is installed (or on Windows), when the app launches, then the Daemons screen
  explains why there is no local daemon, and a remote daemon can still be added and used.
- [ ] Given three registry entries (local, direct with a password, relay link), when the user
  picks each in the native menu, then the app connects to it and shows that daemon's own layout.
- [ ] Given the app was last used on daemon B, when it launches, then it opens on B; if B is
  unreachable it shows the reconnecting state and the switcher still works.
- [ ] Given a daemon is removed, then its layout and secret are gone from disk, and the local
  entry offers no Remove.
- [ ] Given the registry file, then it is readable by the user only and no log line or control
  method returns a password or a pairing link.
- [ ] Given a corrupt settings or registry file, when the app launches, then it starts with
  defaults, the bad file is kept under another name, and a notice says so.
- [ ] Given the app is running, when it is launched again, then the existing window is focused.
- [ ] Given a destructive action (delete a file), then the confirmation is a native dialog; given
  a link in a message, then it opens in the system browser; given "Download", then a native save
  dialog chooses the destination and the file is written there.
- [ ] Given a session rename, then an in-app dialog is shown, in the desktop app and the web client.
- [ ] Given an HTML file with a script, when it is previewed in the desktop app, then the script
  runs (on each platform whose webview passed the spike), and the previewed page cannot call the
  app's commands.
- [ ] Given a file dragged from the OS onto the file explorer, then it uploads, on all three
  platforms.
- [ ] `cargo xtask ci` passes with the `doc`, `ops` and `format` crates gone; the web client's
  build and tests pass unchanged apart from the rename dialog.

## Round log
| Round | Theme | Summary |
|-------|-------|---------|
| 1 | state, Rust side, local daemon | Settings to a Rust-owned file, password unchanged (D1). Checklist deleted, command registry and control socket kept (D2). Auto-start and connect on launch (D3), daemon left running on quit (D4), version mismatch is a notice, not a refusal (D5) |
| 2 | shared workbench, awkward cases | HTML5 drops kept (D6). HTML preview gets its own origin after a spike, with a per-platform fallback (D7). Dialogs: native confirm/alert, in-app rename (D9). CLI found through the login shell (D10). Windows explains the missing local daemon (D11). **New scope from the engineer: a daemon registry in Rust with switching from the native menu (D8)**, which needs a third round |
| 3 | daemon registry | Entries are local, direct or relay (D12). Secrets in the registry file, mode 0600, until the keychain in milestone 2; this replaces the password half of D1 (D13). A Daemons screen in the workbench behind an optional host member, with the native menu for switching (D14). The connection bar becomes a switcher in the desktop app (D15). One window, one daemon at a time, a layout per daemon (D16). Launch opens the last daemon used (D17) |
| 4 | failure modes | Start failure opens the Daemons screen, never blocks (D18). Unreachable last daemon: open on it, reconnecting (D19). Corrupt file: defaults, file kept aside (D20). Single instance (D21). Removal deletes layout and secret; local entry stays (D22). A dead pairing link is replaced in place (D23) |

## Handoff to scope
| Spec file to produce | Fed by brief sections |
|----------------------|-----------------------|
| `swe/features/desktop-daemon-registry.md` | Goals, Happy path, Data & state, D3–D5, D8, D10–D23, Edge cases, Acceptance criteria (registry, supervision, switching) |
| `swe/features/desktop-native-host.md` | D1, D2, D6, D7, D9, Integration points, Non-functional constraints, Acceptance criteria (dialogs, links, save, drops, preview, sample removal) |
| `swe/architecture/workbench-host-adapter.md` (amend) | Integration points: the new optional host members and the removal of `dialogs.prompt` |
