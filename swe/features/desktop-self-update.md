# Feature — Desktop App Self-Update

> **Status: built 2026-11-23 (sprints 131–134), not yet released.** The first piece of the desktop roadmap
> after milestone 4 (owner, 2026-11-23: self-update, then the single-binary daemon, then menus,
> notifications and a tray icon, then OS code signing last).
> Decisions D1–D9 and P1–P18 are from the grill ([../grills/desktop-self-update.md](../grills/desktop-self-update.md),
> confirmed by the owner on 2026-11-23 with "let's scope it"): D1–D9 are the owner's, P1–P18 were
> proposed by the agent and stood at the readout. U1–U14 are proposed in this document; where one
> refines a D or P decision the table says so. **Compatibility is not a concern** (owner,
> 2026-11-22): builds released before this feature are not updated by it.

> Part of: [../MAIN-SCOPE.md](../MAIN-SCOPE.md)
> Dependencies: [desktop-native-host.md](desktop-native-host.md) (the window, the menus, the close
> question), [desktop-daemon-registry.md](desktop-daemon-registry.md) (the command registry, `boot`,
> `settings.set`), [desktop-transport-bridge.md](desktop-transport-bridge.md) (`ui.inspect`, the
> resume signals), [../architecture/workbench-host-adapter.md](../architecture/workbench-host-adapter.md)
> (the host contract; amended here), [../architecture/single-binary-daemon.md](../architecture/single-binary-daemon.md)
> (the exploration that designed this; amended here)
> Desktop rules: `desktop/AGENTS.md`, `desktop/docs/architecture.md`

## Purpose

The app's two users run it from the macOS `.dmg`, the Windows NSIS installer, the Linux AppImage and
the Linux `.deb`. Today they learn of a new build from the Releases page and install it by hand, and
every merge that passes Desktop CI publishes one. This feature makes the app find a newer build by
itself, show it in the window, and install it after one click and a restart, on each of those four.

A build is offered to users only after it has proved, on GitHub's Linux, macOS and Windows machines,
that it can be reached by an update and can update itself (D8): a build whose updater is broken
cannot be repaired by a later release.

Out of scope: OS code signing and notarization (last on the roadmap, D2); updating a daemon (the
single-binary daemon work, D3); links into the app; release notes in the app, a beta channel,
going back to an older build, forced updates, partial downloads, downloading before a click (see
the grill's Deferred list).

## Decisions

### From the grill

| # | Decision |
|---|----------|
| D1 | The app updates itself |
| D2 | OS code signing is not part of this; the updater's own key pair is |
| D3 | Order: self-update, then the single-binary daemon, then menus, notifications and a tray icon, then OS signing |
| D4 | Notify, then one click: the app checks by itself and shows that an update exists; one click downloads and installs; then "Restart to update". Nothing is downloaded and no password is asked before the first click |
| D5 | Shown in the window (a pill at the far right of the connection bar) and through a "Check for Updates…" menu item. The browser client shows nothing |
| D6 | The release per merge stays. The app checks at launch and at most once a day |
| D7 | `.deb` and `.rpm` update in place through `pkexec` only; the app never collects the system password. Without `pkexec`, or when its dialog is cancelled, the app says so and links to the download |
| D8 | On every release a job per system proves the new build can update itself; the build is offered only when all three pass. A failed check leaves the installers published and not offered |
| D9 | The agent generates the private key with no password, stores it as a secret of the repository for the release job, and leaves one copy on the engineer's machine, outside the repository, readable by the engineer only |
| P1 | Rust alone talks to the updater: registry commands, also on the control channel and the CLI; the page gets no plug-in permission |
| P2 | The offered manifest lives in a release with a fixed tag that holds nothing else |
| P3 | `darwin-aarch64` and `darwin-x86_64` both name the one universal update file |
| P4 | Windows: `windows-x86_64-nsis` and `windows-x86_64-msi`, each its own installer, mode `passive` |
| P5 | The plug-in's TLS (`rustls` with `ring`) and the system proxy |
| P7 | `.msi` and `.rpm` get entries, served by the same code as their siblings, not checked live |
| P8 | The user is told the new version and gets a link to its release page; no release notes in the app |
| P9 | A setting, on by default, turns off the checks the app makes by itself; "Check for Updates…" still works |
| P10 | Restarting with a transfer running asks the close question |
| P11 | A bad build is fixed by the next release. No way back, no "skip this version", no forced update |
| P12 | An install the app cannot update in place still shows the newer build, the reason and a link |
| P13 | Quitting instead of restarting: Linux and macOS run the new build at the next launch; Windows offers the update again |
| P14 | After "Restart to update" the app stops checking until it restarts |
| P15 | Builds before this feature are updated by hand once; the version line becomes 0.3.0 |
| P16 | Checks: at launch; 24 h after the last one while running; after a wake when the last is older than that. A failed check the app made by itself is silent |
| P17 | On macOS, an application the user cannot write to gets the system's administrator dialog (the plug-in's) |
| P18 | `ui.inspect` gains an `update` part |

### Proposed here

| # | Point | Decision | Why |
|---|-------|----------|-----|
| U1 | Where the private key lives on GitHub | In a GitHub **environment** `desktop-release` whose deployment branches are `main` only, as the secret `TAURI_SIGNING_PRIVATE_KEY`; only the jobs of a release from `main` name the environment. Refines D9 | A repository secret is readable by a pull request's run from a branch of this repository; an environment restricted to `main` is not |
| U2 | Update files in builds without the key | Only the release jobs of a publishing run make update files (`createUpdaterArtifacts` is switched on by a `--config` overlay in that job, never in `tauri.conf.json`). Pull-request and manual runs build as today | The bundler fails when update files are asked for and the key is absent |
| U3 | Each release's own manifests | Every published release `desktop-v<N>` carries `latest.json` (the manifest naming N) and `self-check.json` (§ Behavior: the self check). Promotion copies `latest.json` into the fixed release | The check reads N's manifest before users are offered it; nothing is built twice |
| U4 | Pointing a build at a manifest that is not the offered one | A launch option `--update-manifest <https-url>`. The plug-in still requires HTTPS and still verifies every file against the public key built into the app, and never installs an older or equal version, so the option can only offer a genuine newer build | The check needs it; it weakens nothing a person able to launch the app with options could not already do |
| U5 | Builds for local and pull-request checks | A **test build** is built with the overlay `src-tauri/tauri.update-test.conf.json`: a throwaway public key, `dangerousInsecureTransportProtocol: true`, update files on. Its key is generated per run and never stored. A test build is never published; a test fails if `tauri.conf.json` holds a `dangerous*` updater key | Lets the Linux container runs and a pull request's run exercise the whole path over plain HTTP from a local server, without the real key |
| U6 | Proving that N can update itself | N updates to its own files, offered under a higher version (`<N's next patch>-selfcheck`) by `self-check.json`. The plug-in compares the `version:` in a signature's trusted comment with the announced version, so every update file is signed a second time with `--app-version <N's next patch>-selfcheck` (a copy of the file in a scratch directory; `tauri signer sign` always writes `<file>.sig`), kept as `<file>.selfcheck.sig`, and `self-check.json` uses those. Proof: the install step succeeded, a new process runs, and the installed file changed | A second build to update to would double the bundle time |
| U7 | `.deb`/`.rpm` install step | The app takes the verified bytes from the plug-in's `download`, writes them to a file of its own (mode 0600, in its cache directory), runs `pkexec dpkg -i <file>` or `pkexec rpm -U <file>`, and removes the file. `pkexec` absent: known at check time, so the state is "cannot install" before any download. Exit 126 or 127 from `pkexec` (dismissed, or not authorised) is "refused". Implements D7 | The plug-in's own install falls back to a password box of its own and to `sudo` |
| U8 | Windows: when does the installer run | The first click downloads and verifies and keeps the bytes in memory; "Restart to update" asks the close question, then hands them to the plug-in's `install`, which starts the installer (`passive`) and ends the app; the installer starts the app again with the same options. Before it ends, the app saves its state as a quit does | The installer replaces the running program, so it can only run at the restart |
| U9 | Time limits | A check: 30 s. A download: 15 min. `pkexec`: none (it waits for the user) | A download of 93 MB on a slow link takes minutes |
| U10 | The menu item | macOS: "Check for Updates…" in the application menu, after About. Linux and Windows: a new Help menu holding it | Where each system puts it |
| U11 | The answer to "Check for Updates…" | A native dialog: "Pi Studio <v> is up to date", or the failure's text, or "Pi Studio <N> is available" with Install and Later (Install runs the first click) | The click comes from a native menu; the indicator alone would not answer "up to date" |
| U12 | An install kind the app cannot read (a development build) | The check reads the entry of the system's first kind (`linux-x86_64-appimage`, `darwin-aarch64`, `windows-x86_64-nsis`) to learn the version, and the state is "cannot install: development build" | P12 needs the version |
| U13 | The installed copy on macOS run from a disk image or a quarantined copy | An application path under `/Volumes/` or under an `AppTranslocation` directory is "cannot install: read-only location" | The swap would fail or land in a copy that disappears |
| U14 | The update indicator's text | Available: "Update <N>"; downloading: "Updating <percent>%"; restart needed: "Restart to update"; cannot install: "<N> available" (a link; the reason is its tooltip); failed: "Update failed" (a retry; the code's text is its tooltip). Idle, checking and up to date show nothing | One short text; the version already sits next to it |

## Public contract

### 1. Configuration and build

| Item | Where | Value |
|------|-------|-------|
| The updater's public key | `tauri.conf.json` → `plugins.updater.pubkey` | The public half of D9's key, committed |
| The offered manifest | `tauri.conf.json` → `plugins.updater.endpoints` | `["https://github.com/avatsaev/pi-studio/releases/download/desktop-updates/latest.json"]` |
| Windows install mode | `plugins.updater.windows.installMode` | `passive` |
| NSIS install mode | `bundle.windows.nsis.installMode` (default) | `currentUser`: an update needs no administrator prompt |
| Update files | `--config` overlay of the publishing release job | `bundle.createUpdaterArtifacts: true` (U2) |
| Test build | `src-tauri/tauri.update-test.conf.json` | U5 |
| Dependency | `desktop/Cargo.toml` | `tauri-plugin-updater = "2"` (the Tauri family moves together), app binary only |
| Version line | `desktop/Cargo.toml` `[workspace.package] version` | `0.3.0` (P15) |

### 2. Release files

Per release `desktop-v<N>` (the installers stay as today):

| File | Update file for | Signature |
|------|-----------------|-----------|
| `Pi.Studio_<N>_amd64.AppImage` | `linux-x86_64-appimage` | `….AppImage.sig` |
| `Pi.Studio_<N>_amd64.deb` | `linux-x86_64-deb` | `….deb.sig` |
| `Pi.Studio-<N>-1.x86_64.rpm` | `linux-x86_64-rpm` | `….rpm.sig` |
| `Pi.Studio.app.tar.gz` (made from the universal `.app`) | `darwin-aarch64`, `darwin-x86_64` | `….app.tar.gz.sig` |
| `Pi.Studio_<N>_x64-setup.exe` | `windows-x86_64-nsis` | `…-setup.exe.sig` |
| `Pi.Studio_<N>_x64_en-US.msi` | `windows-x86_64-msi` | `….msi.sig` |
| `latest.json` | the manifest naming N (U3) | |
| `self-check.json` | the manifest of the self check (U6) | |

Exact file names are the bundler's; the manifest script reads them from the files, not from this table.

The manifest (the plug-in's static format):

```
{ "version": "<N>", "pub_date": "<RFC 3339>", "notes": "<release page URL>",
  "platforms": { "<target>": { "url": "<https asset URL>", "signature": "<contents of the .sig>" }, … } }
```

`notes` carries the release page's address, which the app shows as the link of P8; the plug-in
passes it through as the update's body. The fixed release `desktop-updates` holds `latest.json` only;
it is created with `--latest=false`, so it is never the repository's latest release, and its tag does
not match `desktop-v*`, so the version step keeps ignoring it.

### 3. Engine commands

| Id | Label | Menu | Params | Enabled when | Run |
|----|-------|------|--------|--------------|-----|
| `update.check` | Check for Updates… | U10 | none | not `downloading`, not `restart_needed` | Starts a check; `{ accepted: true }`. From the menu, the answer is U11's dialog |
| `update.install` | Install Update | none | none | `available` or `failed` with an offered version | Starts the download (and on Linux and macOS the install); `{ accepted: true }` |
| `update.restart` | Restart to Update | none | none | `restart_needed` | Asks the close question when transfers run (P10); then restarts (U8 on Windows) |

A command that cannot run now returns its reason, as every registry command does. None takes an
address, a path or a key. The page reaches them through `engine_command`; the list of page
commands and the capability do not change.

The setting: `settings.json` key `checkForUpdates` (boolean, absent reads as `true`), set through
`settings.set` (P9).

### 4. The update state

```
UpdateState =
  | { state: "idle" }                                            // nothing known yet, or checks off
  | { state: "checking" }
  | { state: "up_to_date", checkedAt }
  | { state: "available", version, releaseUrl }
  | { state: "downloading", version, received, total? }
  | { state: "restart_needed", version }
  | { state: "cannot_install", version, releaseUrl, reason }     // P12
  | { state: "failed", code, version?, releaseUrl? }
```

`reason`: `development_build`, `not_writable` (an AppImage file or its directory the user cannot
write to), `read_only_location` (U13), `no_pkexec` (D7). `code`: see § Error handling.

It lives in the shell's UI state, in memory only. It is part of the `boot` answer (`update`), is
sent to the page with the event `update_changed` on every change, and is the `ui.inspect` part
`update` together with `{ current, kind, checksEnabled, manifest: "default" | "override",
lastCheckAt?, lastError? }` (P18). `kind` is `appimage`, `deb`, `rpm`, `app`, `nsis`, `msi` or
`unknown`.

### 5. The host contract (workbench)

One optional member of `WorkbenchHost` (amends `workbench-host-adapter.md`):

```
updates?: {
  current(): AppUpdateState;               // the state above, as the page received it
  subscribe(listener): () => void;
  check(): Promise<void>;
  install(): Promise<void>;
  restart(): Promise<void>;
}
```

The desktop host implements it over `boot`, the `update_changed` event and `engine_command`; the
release link opens through `links.openExternal`. The browser host has no `updates`, so the browser
client shows nothing (D5). The connection bar shows U14's indicator at its far right, after the panel toggles, as a small
pill like the daemon switcher's: orange for an offer or a restart, red for a failure, quiet
for progress and for a build that cannot install, with an icon for what a click does.

### 6. Launch option

`--update-manifest <url>` (U4): the manifest address for this launch, HTTPS unless the build is a
test build. `ui.inspect` says `manifest: "override"`. The app's other launch options are passed on
to the restarted process unchanged, so a run driven through `--control` keeps its control port. On
macOS Tauri restarts with `open -n <bundle> --args …` while the old process still holds that port, so
`control_server::bind` retries a port in use for 10 s (found by the release check, 2026-11-23).

### 7. Where the code lives

| Piece | Place |
|-------|-------|
| The commands, their `enabled` and reasons | `crates/engine` (`update_cmds.rs`) |
| The state, its transitions, the schedule of checks (P16), the menu entries, `ui.inspect` and `boot` parts | `crates/shell`; the updater behind a `Services` hook, so the crate stays free of Tauri (rule 4) |
| The setting | `crates/model` (`Settings`) |
| The plug-in, the check, download and install off the owner thread, the `pkexec` step, the restart | `apps/pistudiodesktop/src-tauri` (`update.rs`) |
| The host member | `apps/pistudiodesktop/src/host` (`updates.ts`) |
| The indicator | `packages/workbench` (connection bar), `host/types.ts` |
| The manifest script | `apps/pistudiodesktop/scripts/release/update-manifest.mjs` (+ test) |
| The release check | `apps/pistudiodesktop/scripts/platform-checks/update-check.mjs` (+ test), run by `desktop-release.yml` |

## Behavior & algorithms

### The release workflow

```
version  -> as today
bundle   -> as today, per system; in a publishing run (environment desktop-release, U1) with the
            update-files overlay (U2) and the key: every update file gets its .sig
release  -> publish desktop-v<N>: installers, update files, signatures,
            latest.json and self-check.json made by update-manifest.mjs
update-check (Linux, macOS, Windows, after release; fail-fast off)
         -> per system and per kind in use (Linux: AppImage, then .deb):
              P := the version desktop-updates/latest.json names, if that build has the updater
              if P: install P's installer; launch P with --update-manifest <release N>/latest.json,
                    --control, a scratch --config-dir, --secret-store file;
                    run update.check, update.install, update.restart; expect version N running
              else: install N's installer
              launch N with --update-manifest <release N>/self-check.json; update.check,
              update.install, update.restart; expect a new process, the install step succeeded,
              the installed file changed
promote  -> needs every update-check job: replace desktop-updates/latest.json with release N's
            (create the release with --latest=false the first time)
```

A failed update-check fails the run, and `promote` does not run: users keep being offered the build
before; the installers of N stay downloadable by hand. Re-running the failed job and then `promote`
offers N. Releases already run one at a time (`concurrency`), so the manifest moves in release
order. In a pull-request run that changes the workflow or the check script, the same jobs run on a
test build (U5) against a local HTTP server, and `release`/`promote` do nothing.

On the Linux runner the `.deb` step needs `pkexec` to succeed without a person: the job installs a
polkit rule that lets the runner's user run `org.freedesktop.policykit.exec` without
authentication, and removes it at the end. The AppImage step needs FUSE (`libfuse2`) on the runner.

### The app

```
at launch, when checkForUpdates (P9):          check(automatic)
every hour: if checkForUpdates and the last check is 24 h old and state not restart_needed: check(automatic)
on a wake signal (resume.rs): same test as the hourly one
update.check (menu, page, control):           check(manual)

check(origin):
    if state in {downloading, restart_needed}: refuse (enabled says why)
    state = checking
    kind = the install kind (bundle type; macOS: inside a .app or not)
    ask the plug-in, 30 s, at the manifest (default or --update-manifest),
        for target kind's entry (U12 when kind is unknown)
    newer version found:
        if kind unknown:                                    cannot_install(development_build)
        elif AppImage file or its directory not writable:   cannot_install(not_writable)
        elif macOS path under /Volumes or AppTranslocation: cannot_install(read_only_location)
        elif kind in {deb, rpm} and no pkexec on PATH:      cannot_install(no_pkexec)
        else:                                               available(version, releaseUrl)
    none newer:  up_to_date
    error:       origin automatic -> back to the state before (or idle), log the code
                 origin manual    -> failed(code)
    origin menu: U11's dialog

update.install:
    state = downloading(version, 0, total)        progress events update received/total
    bytes = plug-in download, 15 min, signature verified by the plug-in
    Windows:        keep bytes; state = restart_needed
    AppImage, app:  plug-in install(bytes); state = restart_needed
    deb, rpm:       write bytes to a 0600 file in the cache directory;
                    pkexec dpkg -i | rpm -U <file>; remove the file;
                    exit 0 -> restart_needed; 126/127 -> failed(refused); other -> failed(install)
    any error: failed(code, version, releaseUrl); nothing is changed on disk by a failed step

update.restart:
    if transfers run and the close question is answered no: stay
    Windows: save state as a quit does; plug-in install(bytes) starts the installer and ends the app
    else:    request a restart (Tauri releases the single-instance lock before it starts the new process)
```

P14: in `restart_needed` no check runs. P13: quitting in `restart_needed` leaves the installed build
for the next launch on Linux and macOS; on Windows the kept bytes are dropped.

## Data & persistence touchpoints

- `settings.json`: `checkForUpdates` (absent = `true`). No migration.
- The update state and the time of the last check: in memory only; a launch starts from `idle`.
- The `.deb`/`.rpm` file of U7: in the app's cache directory, removed after the step, and removed at
  launch if a crash left it.
- GitHub: the per-release `latest.json` and `self-check.json`; the release `desktop-updates` with
  `latest.json`; the environment `desktop-release` with the secret.
- The engineer's machine: `~/.config/pi-studio-release/updater.key` (mode 0600), the private key's
  only copy outside GitHub (D9). The public key is in `tauri.conf.json`.

## Error handling & edge cases

| Code | When | Shown |
|------|------|-------|
| `offline` | The manifest or the file could not be reached (no network, DNS, TLS, time limit) | "Could not reach the update server" |
| `manifest_invalid` | Not JSON, not the format, a version that is not one | "The update information is not valid" |
| `no_target` | The manifest has no entry for this install's kind | "No update for this kind of install" |
| `signature` | The file's signature does not match the key built in | "The update's signature does not match" |
| `download` | The download ended early or returned an error status | "The download failed" |
| `install` | The install step failed (swap, AppImage rewrite, `dpkg`/`rpm` error, installer could not start) | "The update could not be installed" |
| `refused` | `pkexec` was dismissed or not authorised | "The system did not allow the install" (the click opens the release page: another try is refused too) |

| Condition | Expected behavior |
|-----------|-------------------|
| The manifest names a version equal to or older than this one | `up_to_date`; never a downgrade (P11) |
| A check the app made by itself fails | Silent: the state before stays; the code is logged; the next check is P16's |
| The connection drops during the download | `failed(download)`; a click starts again from zero (no resume) |
| The manifest is replaced while an app reads it | The old one, the new one, or a 404 for a moment (`offline`, silent when automatic) |
| A second launch while the first runs | The single-instance plug-in focuses the first window |
| The restart races the single-instance lock | It does not: Tauri releases the lock in its exit clean-up before it starts the new process (read in `tauri` 2.12.5 and `tauri-plugin-single-instance` 2.5.5) |
| Windows: the plug-in ends the app with `exit(0)` | The app saved its state first (U8); the OS releases the instance lock with the process |
| The updated app expects a newer daemon | The existing one-time notice (`minDaemonVersion`); the daemon is not updated |
| macOS keychain after an update | Expected to ask again per stored secret (ad-hoc signature, D2). Accepted |
| The update-check fails for a reason that is not the build | The build is not offered; re-run the failed job, then `promote` |
| The key is lost | Both users install by hand a build that carries a new public key (runbook) |
| The key leaks | Release a build carrying a new public key, signed with the old key; then replace the secret (runbook) |
| A page script calls `update.*` | The same as any registry command; the worst is starting the one signed update |
| What the check sends | One GET with `User-Agent: tauri-plugin-updater/<version>` and `Accept: application/json`, the system proxy followed (read in the plug-in 2.14.1) |
| Logging | Codes, versions and the kind only; no URL but the fixed manifest address, never the key |

## Dependencies on other specs

- [desktop-native-host.md](desktop-native-host.md) — the menu bar, the close question, the window
  state saved at quit; amended: links into the app are no longer milestone 5.
- [desktop-daemon-registry.md](desktop-daemon-registry.md) — the command registry, `boot`,
  `settings.set`.
- [desktop-transport-bridge.md](desktop-transport-bridge.md) — `ui.inspect`, the wake signal.
- [../architecture/workbench-host-adapter.md](../architecture/workbench-host-adapter.md) — the
  optional `updates` member; amended.
- [../architecture/single-binary-daemon.md](../architecture/single-binary-daemon.md) — the app's
  self-update section is this feature; its statement that `.deb` and `.rpm` installs can only be
  told about a new version is wrong for the plug-in 2.14.1; amended.

## Acceptance criteria

Unit and integration (in `cargo xtask ci` and `npm test`):

- [x] The state transitions of § Behavior, every code and reason, P14 and the schedule of P16 (a
  fake clock), with the updater behind a fake `Services` hook.
- [x] `enabled` and the refusal reasons of the three commands in each state.
- [x] `checkForUpdates` absent reads as `true`; `false` stops the automatic checks, not `update.check`.
- [x] The `pkexec` step: exit 0, 126, 127 and another code map to `restart_needed`, `refused`,
  `refused`, `install`; the file is 0600 and removed in every case; with no `pkexec` the state is
  `cannot_install(no_pkexec)` before any download.
- [x] `update-manifest.mjs` makes the manifest of § 2 from a directory of files; a fixture it made
  is read by the plug-in's own `RemoteRelease` type in a Rust test.
- [x] `tauri.conf.json` holds no `dangerous*` updater key; the test build's overlay does.
- [x] `cargo xtask ci` passes; `Cargo.lock` has no `aws-lc` package; `ATTRIBUTION.md` lists the new
  crates and every licence is permissive; the page's capability and command list are unchanged.
- [x] No command answer, log line, `boot` or `ui.inspect` part holds the key or a file path of the update.

Live, Linux, in the `pi-desktop-xvfb` container, test builds (U5) from a local HTTP server:

- [x] AppImage: with build A running and build B offered, the connection bar shows "Update B" and
  nothing was downloaded; a click shows the progress, then "Restart to update"; a click restarts the
  app, which shows version B; `ui.inspect.update` reads `idle` or `up_to_date`.
- [x] `.deb`: the same, with a polkit agent answering; dismissed, the state is `failed(refused)` with
  the link; with `pkexec` removed, `cannot_install(no_pkexec)` and no download.
- [x] A file whose signature does not match: nothing changes on disk, the app still runs as A,
  `failed(signature)`.
- [x] No network: nothing shown, one code logged; "Check for Updates…" answers with the failure.
- [x] A transfer running at "Restart to update": the close question; Cancel keeps the app and the transfer.
- [x] The browser client looks unchanged and shows no indicator (seen in a browser).

Release, on GitHub:

- [x] A pull request changing the workflow runs the update-check on the three systems with test builds and publishes nothing.
- [ ] The first publishing run after the merge: N's self check passes on Linux (AppImage and `.deb`),
  macOS and Windows; `desktop-updates/latest.json` then names N; the time the check added is recorded.
- [ ] The next publishing run: the build before updates itself to the new one on the three systems
  before the manifest moves.
- [ ] A run whose check fails on one system leaves the manifest naming the build before and fails.
- [x] `desktop/docs/development.md` § Releasing holds the key's runbook (where it is, lost, leaked)
  and how to re-run a failed check.

## Resolved by the build (sprints 131–134)

- `ring`-based `rustls` keeps `aws-lc` out of `Cargo.lock`; the new crates' licences are permissive and
  listed in `ATTRIBUTION.md` (131/t001).
- A polkit rule lets `pkexec` run without an agent in the container (the rule or a text agent answering;
  dismissed gives exit 127) and on GitHub's Ubuntu 24.04 runner after `sudo systemctl start polkit`
  (`dbus` was already running); the script installs and removes the rule itself (134/t001, 134/t002).
- The AppImage rewrites itself on the runner with `libfuse2t64`; in the container it ran extracted
  (`APPIMAGE_EXTRACT_AND_RUN=1`, no `/dev/fuse`), where Tauri logs a harmless "not detected as an
  AppImage" warning and `kind` still reads `appimage`.
- `/Applications` is writable by the macOS runner's user; no administrator dialog (134/t002).
- The bundler signs the `.deb`, the `.rpm` and, on Windows, the `.msi` (their `.sig` files appear in a
  pull-request run's N build); the macOS universal `.app.tar.gz` and the NSIS setup too.
- The check's time: Linux 83 s (AppImage about 10 s, `.deb` about 24 s, apt prerequisites 16 s), macOS
  33 s, Windows 53 s per job in the pull-request run; the build of P and N is the larger cost (bundle
  jobs 10–18 min each, built twice in a pull-request run).

## TODO(verify)

- How long the update check adds to a real release (the PR run builds P as well, a publishing run
  downloads it). — measured in the first publishing run.
- The real key's signature on a real build, `bundle-release` with the environment, the real upload and
  GitHub's rename of spaces to dots in asset names, `promote`. — the first publishing run.
- Not seen live: a FUSE-mounted AppImage, a graphical polkit agent's Cancel (exit 126), `.rpm`, `.msi`,
  the codes `manifest_invalid`, `no_target`, `download` against a real app.
- Not checkable without a Mac: the keychain prompts after an update; an application never moved out
  of Downloads (reported as `read_only_location` only when translocated). — nobody (accepted, D2).
