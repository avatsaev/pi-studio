# Grill — Desktop app self-update

> Status: grilled
> Confirmed: the engineer answered the readout with "let's scope it" (2026-11-23), changing none of
> P1–P18. Spec: [../features/desktop-self-update.md](../features/desktop-self-update.md).
> Started: 2026-11-23   Last updated: 2026-11-23   Rounds: 2
> Engineer: avatsaev   Agent: Claude (omp)

## Raw idea

From the single-binary exploration (`swe/architecture/single-binary-daemon.md` § Owner's decisions,
2026-11-22):

> The desktop app can update itself.

and, on 2026-11-23, after milestone 4 was merged, the agent's proposal and the engineer's answer:

> My suggestion for the order is self-update first, then the single-binary daemon, then the menus,
> notifications and tray.

> Agreed

The same day the engineer moved OS code signing to the very end ("for now there are only two users
and they are okay with no signature warning") and dropped links into the app ("let's scratch that
for now").

## Codebase context

| Area | Path(s) | Fact that matters |
|------|---------|-------------------|
| Release workflow | `.github/workflows/desktop-release.yml` | Every Desktop CI pass on a push to `main` publishes a GitHub Release `desktop-v<version>` at once (no draft, fixed notes). The version is the patch after the highest tag, written into the runner's copy only. Plain `tauri build` and `gh release create`; no updater artifacts, no signatures, no manifest |
| Release assets | release `desktop-v0.2.1` | Six files: `.deb`, `.rpm`, `.AppImage` (93 MB), universal `.dmg`, NSIS `-setup.exe`, `.msi`. The repository is public, so assets download without a login |
| Signing today | `desktop-release.yml` (`APPLE_SIGNING_IDENTITY: "-"`) | macOS is ad-hoc signed, Windows unsigned. A keychain item is bound to the build's signature, so macOS is expected to ask again after each update (`swe/features/desktop-transport-bridge.md`, never seen live) |
| Tauri config | `desktop/apps/pistudiodesktop/src-tauri/tauri.conf.json` | `bundle.targets: "all"`; no `plugins` section; no `createUpdaterArtifacts`. Identifier `com.avatsaev.pi-studio` |
| Tauri versions | `desktop/Cargo.toml`, `Cargo.lock` | `tauri` 2.12.5; plug-ins in use: dialog, opener, single-instance. `tauri-plugin-updater` is at 2.14.1 (needs Rust 1.90; the workspace is on 1.95) |
| Updater plug-in, read in its source (2.14.1) | crates.io `tauri-plugin-updater` | Signature check cannot be turned off. Looks up `{os}-{arch}-{bundle_type}` in the manifest, then `{os}-{arch}`. Linux: rewrites an AppImage in place; installs a `.deb` with `dpkg -i` and an `.rpm` with `rpm -U` through `pkexec`, else a `zenity`/`kdialog` password box and `sudo`, else `sudo` in a terminal. macOS: swaps the `.app` from a `.app.tar.gz`, asking for an administrator password through `osascript` when the bundle is not writable. Windows: runs the NSIS or MSI installer (default mode `passive`), which ends the app. HTTPS endpoints are enforced. Default features: `rustls` with `ring`, the system proxy, `zip` |
| TLS rule | `desktop/xtask/src/layers.rs` (`FORBIDDEN_PACKAGES`) | `cargo xtask layers` fails on `aws-lc-rs`/`aws-lc-sys` in `Cargo.lock`. The plug-in's default TLS is `ring`; `reqwest` 0.13.5 is already in the lock |
| Proxies | `swe/features/desktop-transport-bridge.md` | Daemon connections ignore system HTTP proxies. The plug-in's default follows them |
| Commands | `desktop/AGENTS.md` rule 3; `desktop/crates/engine/src/*_cmds.rs` | Everything Rust does for a user is a registry command (id, label, menu, shortcut, `enabled`, `run`, tests), also reachable from the control channel and the CLI. Today: `daemon.*`, `settings.get/set`, `command.list` |
| Webview boundary | `desktop/AGENTS.md` rule 6; `src-tauri/capabilities/default.json` | The page may call only the app's own 21 commands and listen to events; no plug-in permission. So the updater can run from Rust only |
| Menus | `desktop/apps/pistudiodesktop/src-tauri/src/menu.rs`, `crates/shell/src/menus` | The bar is generated from the shell's model. macOS has the standard application menu (About, Hide, Quit); the Daemons menu exists on all three systems |
| Page events | `src-tauri/src/{daemons,menu,resume,transfers/engine}.rs` | Rust tells the page things with events: `daemons_changed`, `daemons_manage`, `connection_resume`, `transfer_progress` |
| Host contract | `packages/workbench/src/host/types.ts` (`AppIdentity`) | The page gets `title`, `version`, `platform`, `minDaemonVersion`, static for the life of the page; the version is shown in the connection bar. There is no member about updates |
| App version | `desktop/crates/shell/src/page.rs` | `env!("CARGO_PKG_VERSION")` |
| Settings | `desktop/crates/model/src/lib.rs` (`Settings`) | `settings.json`: `version`, `autoStartLocalDaemon`, `cliPath`, the workbench's keys; unknown keys are kept. `settings.set` sets one by name |
| Closing with work in flight | `src-tauri/src/transfers.rs` (`CloseRequested`) | Closing the window while a transfer runs asks first. Quitting leaves the local daemon running |
| Second launch | `tauri-plugin-single-instance` | A second launch focuses the first window. Whether `restart()` after an update races with it is not known |
| Daemon self-update | `swe/features/self-update.md` | Specified, not built: nothing in the workbench, the server or the protocol answers `update_*`. So no other "update" surface exists in the window today |
| Daemon version floor | `AppIdentity.minDaemonVersion` (0.0.127) | A newer app may ask for a newer daemon than the one running; the page shows a one-time notice |
| Checks without a person | `desktop/docs/development.md` (the `pi-desktop-xvfb` recipes), `--control`, `--config-dir`, `--secret-store file` | Live runs happen on Linux in a container, driven through the control channel. macOS and Windows are built by the release workflow and not run |
| Runner checks | `.github/workflows/desktop-platform-checks.yml`, `apps/pistudiodesktop/scripts/platform-checks/` | A manual workflow already builds the app on GitHub's macOS and Windows runners and drives it (control socket on macOS, WebDriver on Windows). It publishes nothing and never runs on a push to `main` |

## Problem & outcome
- **Who:** the app's two users, on macOS (`.dmg`), Windows (the NSIS `setup.exe`), Linux AppImage and
  Linux `.deb` (engineer, round 1). Nobody uses the `.msi` or the `.rpm`.
- **Today:** a user learns of a new build by looking at the Releases page, downloads an installer and
  runs it by hand; on macOS and Windows each time through the unsigned-build warning.
- **Done means:** a running app finds out by itself that a newer build exists, shows it in the
  window, and installs it after one click and a restart, on each of the four installers in use.
- **Measured by:** on each of the four, a build of version A becomes version B through the app alone,
  with the version in the connection bar as the proof.

## Goals
- The app checks for a newer build at launch and at most once a day while it runs (D6).
- An update is shown in the window: an indicator next to the version in the connection bar, and a
  "Check for Updates…" menu item (D5).
- One click downloads and installs; a second, "Restart to update", restarts. Nothing is downloaded
  and no password is asked before the first click (D4).
- Every installer in use updates in place; a `.deb` asks for the system password (D7).
- A release per merge stays; no manual step is added for the engineer (D6).
- A build is offered to users only after it has proved, on Linux, macOS and Windows, that it can be
  reached by an update and can update itself (D8).

## Non-goals
- OS code signing and notarization: last on the roadmap (owner, 2026-11-23).
- Updating a daemon, local or remote: the single-binary daemon work that follows.
- Links into the app (owner, 2026-11-23).
- Release notes in the app, a second (beta) channel, going back to an older build, forced updates,
  partial (delta) downloads, downloading before the user clicks (see Deferred).

## Happy path
1. **A merge.** Desktop CI passes on `main`. The release workflow builds the installers as today,
   and with them the update files and their signatures, made with the updater's private key. It
   publishes the release `desktop-v<N>`. Users are not offered it yet: the manifest still names the
   build before.
2. **The check (D8).** On a Linux, a macOS and a Windows machine of GitHub, the build offered before
   updates itself to N through the published files, and N then proves it can update itself. When all
   three pass, the manifest is replaced and names N. When one fails, the manifest stays, the run
   fails (GitHub tells the engineer), and the installers of N stay downloadable by hand.
3. **The app notices.** A user's app checks at launch, and once a day while it runs. It reads the
   manifest, finds N newer than itself, and shows "Update available" next to the version in the
   connection bar. Nothing is downloaded.
4. **First click.** The user clicks the indicator. The app downloads N, shows the progress, checks
   the signature, and installs it: the AppImage file or the macOS application is replaced; a `.deb`
   install shows the system's password dialog first. On Windows the installer is kept for step 5.
   The indicator now says "Restart to update".
5. **Second click.** If a transfer is running, the app asks, as it does when the window is closed.
   Then it restarts (on Windows the installer runs first and starts the app again).
6. **Result.** The connection bar shows version N. The app reconnects to the daemon used last, as at
   any launch. The daemon was never stopped.

"Check for Updates…" in the menu runs step 3 at once and always answers: an update, "up to date",
or why the check failed.

## Decisions
| # | Theme | Question | Decision | Rationale | Round |
|---|-------|----------|----------|-----------|-------|
| D1 | scope | Does the app update itself? | Yes | Owner, 2026-11-22 (`single-binary-daemon.md`) | 0 |
| D2 | scope | Is OS code signing part of this? | No. The updater's own key pair is; OS signing is last on the roadmap | Owner, 2026-11-23: two users, who accept the warnings | 0 |
| D3 | order | What comes after this? | The single-binary daemon, then menus, notifications and a tray icon, then OS signing | Owner, 2026-11-23 | 0 |
| D4 | behaviour | How does an update reach the user? | Notify, then one click: the app checks by itself and shows that an update exists; one click downloads and installs; then "Restart to update" | No download and no password prompt without a click; the same on every system | 1 |
| D5 | surface | Where does the user see it? | In the window: an indicator next to the version in the connection bar, and a "Check for Updates…" menu item. The browser client shows nothing | A native dialog at launch interrupts. Costs a new member of the workbench's host contract | 1 |
| D6 | cadence | How often is an update offered, with a release per merge? | The release per merge stays. The app checks at launch and at most once a day | No manual step; accepted: a bad build can reach users within a day, and a macOS user may get keychain prompts after each update (D2) | 1 |
| D7 | linux | `.deb` and `.rpm` installs | Updated in place through the system's password dialog (`pkexec`). The plug-in's fallbacks (its own password box, `sudo` in a terminal) are not used: without `pkexec`, or when the dialog is cancelled, the app says so and links to the download | The app should never collect the system password itself. To hold this the app runs the install step for these two kinds itself (the plug-in still checks, downloads and verifies) | 1 |
| D8 | verification | How is updating checked on macOS and Windows, with no person? | On every release: after the installers are built, a job per system proves the new build can update itself; users are offered the build only if all three pass. A failed check leaves the installers published and not offered | A build whose updater is broken cannot be repaired by a later release. The repository is public, so runner minutes cost nothing. Accepted: every release gets slower by the length of the check (agent's estimate, not measured: 5 to 10 minutes) | 2 |
| D9 | key | Who creates and keeps the updater's private key? | The agent generates it, with no password, stores it as a secret of the repository for the release job, and leaves one copy in a file on the engineer's machine, readable by the engineer only and outside the repository, for the engineer to back up | Lost: installed apps can never update again and are reinstalled by hand. Leaked: someone who can also publish to the releases could ship a build the apps accept | 2 |

### Proposals of the agent, to confirm at the readout

Low-impact points the agent decides unless the engineer objects (the engineer asked not to be
asked about these).

| # | Point | Proposal | Why |
|---|-------|----------|-----|
| P1 | Who talks to the updater | Rust only: registry commands, also on the control channel and the CLI; the page gets no plug-in permission and learns the state through an event and its `boot` answer | Rules 3 and 6 of `desktop/AGENTS.md` |
| P2 | Where the manifest lives | The release job builds `latest.json` from the `.sig` files and uploads it to a release with a fixed tag that holds nothing else, replacing the file each time; the app's endpoint is that file | `releases/latest/download/…` breaks as soon as another kind of release (the daemon binary) becomes the repository's latest |
| P3 | macOS targets | `darwin-aarch64` and `darwin-x86_64` both name the one universal `.app.tar.gz` | One build serves both |
| P4 | Windows targets | `windows-x86_64-nsis` and `windows-x86_64-msi`, each its own installer, mode `passive` | An MSI install must be updated by an MSI |
| P5 | TLS and proxy | The plug-in's defaults: `rustls` with `ring`, the system proxy followed | No `aws-lc`; an update check behind a company proxy should work even though daemon connections ignore proxies |
| P6 | The private key | Became D9 | |
| P7 | Installers nobody uses (`.msi`, `.rpm`) | Listed in the manifest and served by the same code as their siblings; not checked live | The entries cost nothing; dropping them would leave those installs silently stuck |
| P8 | What the user is told about a new build | Its version, and a link to its release page. The release notes stay the fixed text of today | With a release per merge, a list of changes per build is noise; see Deferred |
| P9 | Turning it off | A setting, on by default, set through `settings.set`. Off stops the checks the app makes by itself; "Check for Updates…" still works | A user on a metered or closed network; nothing else of the app calls out by itself |
| P10 | Restarting with a transfer running | The same question as closing the window | One rule for "this ends your transfer" |
| P11 | A bad build | Fixed by the next release. The app never goes back to an older build, has no "skip this version", and no update is forced | The updater refuses older versions by design; an older installer can still be run by hand |
| P12 | An install the app cannot update in place | The indicator still shows that a newer build exists, says why it cannot install it, and links to the download. Cases: a development build; an AppImage file or a macOS application the user cannot write to and for which the system offers no password dialog; an application run straight from the disk image; `pkexec` absent or its dialog cancelled (D7) | The user must not be left believing they are up to date |
| P13 | Quitting instead of "Restart to update" | Linux and macOS: the new build is already in place and runs at the next launch. Windows: the installer has not run; the download is dropped and the next launch offers the update again | The Windows installer has to end the app, so it can only run at the restart |
| P14 | After "Restart to update" is shown | The app stops checking until it restarts | The running process still reports the old version, so another check would offer the same build again |
| P15 | Builds installed before this feature | They never update themselves. Each user installs the first build with the updater by hand, once. The version line is raised to 0.3.0 with it | There is no updater in them to reach |
| P16 | When the app re-checks | At launch; 24 hours after the last check while it runs; and after a wake from sleep when the last check is older than that. A failed check by the app itself is silent and waits for the next of these | A laptop that sleeps for days should not wait another day |
| P17 | The macOS password prompt | Accepted: when the application is not writable by the user, the plug-in asks for an administrator password through the system's own dialog | It is the system's dialog, unlike the plug-in's own password box on Linux (D7) |
| P18 | What a live run reads | `ui.inspect` gains an `update` part: the state, this version, the offered version, the kind of install, the time of the last check and the code of the last failure | The runner checks and the Linux runs need it; it holds no secret |

## Data & state
- **`settings.json`:** one new key, whether the app checks by itself (default: yes). A file without
  it reads as yes. Nothing to migrate.
- **In memory only, in Rust:** the update state: idle, checking, available (version, link), downloading
  (received, total), restart needed, cannot install (reason), failed (code); and the time of the last
  check. Nothing of it is stored: a launch starts from idle and checks.
- **The page:** the workbench's host contract gains one optional member that gives the state, tells
  the page when it changes, and has the three actions (check, install, restart). The browser host
  does not have it, so the browser client shows nothing (D5).
- **Build configuration:** the updater's public key and the manifest's address in
  `tauri.conf.json`; update files switched on in the bundle settings.
- **Per release:** an update file per installer kind where the installer itself is not one (macOS:
  a `.app.tar.gz`), a signature per update file, and the manifest: the version and, per target, an
  address and a signature. Targets: `linux-x86_64-appimage`, `-deb`, `-rpm`, `darwin-aarch64`,
  `darwin-x86_64`, `windows-x86_64-nsis`, `-msi` (P3, P4, P7).
- **The manifest's home:** one release with a fixed tag that holds the manifest and nothing else
  (P2). It is not the repository's latest release and its tag is not a `desktop-v*` version, so the
  version step of the release workflow must keep ignoring it.
- **The key:** the private half as a secret of the repository and in one file on the engineer's
  machine (D9); the public half in the repository.

## Integration points
| Existing module / service / config | How the feature touches it | Direction | Risk / note |
|------------------------------------|----------------------------|-----------|-------------|
| `.github/workflows/desktop-release.yml` | Signs the update files; publishes them with the installers; runs the check of D8 per system; replaces the manifest only when all pass | writes | The pull-request and manual runs of this workflow build without the key and publish nothing; the key must not be readable by a pull request's run |
| `.github/workflows/desktop-platform-checks.yml` and `apps/pistudiodesktop/scripts/platform-checks/` | The check of D8 reuses how these scripts start and drive the app on macOS and Windows | reads | On macOS the app is driven through the control socket only (no WebDriver) |
| `desktop/apps/pistudiodesktop/src-tauri/tauri.conf.json` | Public key, manifest address, update files | writes | The Content-Security-Policy does not change: the page makes no request |
| `desktop/Cargo.toml`, `Cargo.lock`, `ATTRIBUTION.md`, `xtask` layers | New dependency `tauri-plugin-updater` (app binary only) | writes | Must bring no `aws-lc` and only permissive licences (rule 9) |
| `desktop/crates/engine` (commands) | New commands for check, install and restart, with ids, labels, the menu item and their "cannot run now" reasons | writes | Rule 3. The page reaches them through the existing `engine_command`, so the list of page commands does not grow |
| `desktop/crates/shell` (UI state, menus, `Services`) | The update state in the UI model; "Check for Updates…" in the generated menus; the plug-in behind a `Services` hook so the crate stays free of Tauri | writes | Rule 4 |
| `desktop/crates/model` (`Settings`) | The new key | writes | |
| `desktop/apps/pistudiodesktop/src-tauri/src` | Starts the plug-in; runs the check, the download and the install off the owner thread; tells the page with an event; restarts | writes | The single-instance plug-in at restart (open question) |
| `src-tauri/src/transfers.rs` (the close question) | "Restart to update" asks the same question | reads | P10 |
| `packages/workbench/src/host/types.ts`, the connection bar | The optional host member; the indicator and its states | writes | The browser client must look unchanged (checked in a browser) |
| `desktop/apps/pistudiodesktop/src/host` | The desktop host implements the member over the event and `engine_command` | writes | |
| `ui.inspect` (control protocol) | The `update` part (P18) | writes | `desktop/docs/control-protocol.md` |
| `swe/architecture/single-binary-daemon.md` | Says `.deb` and `.rpm` can only be told about a new version: no longer true of the plug-in | corrects | |
| `docs/desktop-client-handoff.md`, `swe/features/desktop-native-host.md` | The order of D3; links into the app are no longer milestone 5 | corrects | Both still state the old plan |

## Edge cases & failure modes
| Area | Condition | Decided behavior | Decision |
|------|-----------|------------------|----------|
| inputs | The manifest is missing, not JSON, has no entry for this install's target, or a version that is not a version | No update is offered. A check by the app is silent; "Check for Updates…" says the check failed. The code is logged | P16 |
| inputs | The downloaded file's signature does not match, or the download is cut short | Nothing is installed; the indicator shows the failure and a click tries again from the start | D4 |
| inputs | The manifest names a version equal to or older than this one | "Up to date". Never a downgrade | P11 |
| inputs | Size | The download is held in memory by the plug-in: about 93 MB for the AppImage, 27 MB on macOS, 13 MB on Windows. Accepted | |
| identity & access | The user cannot write to the AppImage file or the macOS application | macOS: the system's administrator dialog (P17). AppImage: cannot install in place (P12) | P12, P17 |
| identity & access | `.deb`/`.rpm`: no `pkexec`, the dialog is cancelled, or the password is wrong | Nothing is installed; the indicator says so and links to the download. The app never asks for the password itself | D7 |
| identity & access | A page script calls the update actions | They are registry commands behind `engine_command` like any other; they take no address, file or key from the page, so the worst a page can do is start the one signed update | P1 |
| state | Already up to date | The indicator is absent; "Check for Updates…" says so | |
| state | The update is installed and the app has not restarted | "Restart to update"; no further check (P14). Quitting instead: P13 | P13, P14 |
| state | A development build, or a kind of install the app does not know | Checks still run; it cannot install in place (P12) | P12 |
| state | A second launch while the first runs | n/a: the single-instance plug-in focuses the first window | |
| timing | Offline, or GitHub slow or down | The check ends within a fixed limit. Silent when the app made it; the next one is P16 | P16 |
| timing | The connection drops during the download | Failure shown; a click starts again from zero. No resume | |
| timing | A transfer is running at "Restart to update" | The close question | P10 |
| timing | The machine sleeps for days | A check after the wake (P16) | P16 |
| timing | The manifest is being replaced while an app reads it | The app sees the old one, the new one, or nothing for a moment; nothing is treated as a failed check | P16 |
| timing | Two merges close together | The release workflow already runs one release at a time; the manifest moves once per passing release, in order | D8 |
| scale | Two users; one manifest read per launch and per day | n/a: no limit of GitHub's is near | |
| scale | A release per merge means a full download per update, up to once a day | Accepted (D6). Partial downloads are deferred | D6 |
| dependencies | The check of D8 fails for a reason that is not the build (a runner fault, GitHub down) | The build is not offered; re-running the failed job offers it. Nothing is offered on a guess | D8 |
| dependencies | A proxy is required to reach GitHub | The system proxy is followed (P5) | P5 |
| dependencies | The updated app expects a newer daemon than the one running | The existing one-time notice (`minDaemonVersion`). The app does not update the daemon (non-goal) | |
| dependencies | The plug-in changes its manifest format in a later version | A test builds a manifest with the release job's script and reads it with the plug-in's own types | |
| data lifecycle | Builds installed before this feature | Installed by hand once (P15) | P15 |
| data lifecycle | Stored secrets after an update on macOS | The keychain is expected to ask again per stored secret (ad-hoc signature). Accepted until OS signing | D2 |
| data lifecycle | `daemons.json` or `settings.json` written by a newer build | n/a here: the app never goes back to an older build by itself | P11 |
| observability & ops | What is logged | A code per step and failure; the versions. No address beyond the fixed manifest address | |
| observability & ops | The feature turned off | The setting of P9 | P9 |
| observability & ops | A build that is bad after it was offered | The next release fixes it (P11). Users who took it keep it until then | P11 |
| observability & ops | The key is lost | Both users reinstall by hand a build that carries a new public key. Written into the release runbook | D9 |
| observability & ops | The key leaks | A release that carries a new public key, signed with the old key, then the secret is replaced. Written into the release runbook | D9 |

## Non-functional constraints
| Concern | Constraint / decision |
|---------|-----------------------|
| Performance / volume | The check is one small request. Check, download and install never run on the owner thread, so the window and a terminal stay responsive during a download. Up to 93 MB held in memory during a download (accepted) |
| Security & authorization | Every update is verified against the public key built into the app; this cannot be turned off. HTTPS only. The private key is a secret that only the release on `main` reads. The page gets no new permission and no command takes an address, a path or a key from it. The app never handles the system password (D7). New dependencies pass the licence rule and bring no `aws-lc` |
| Privacy | A check tells GitHub the machine's address and nothing about the user or the daemons. It can be turned off (P9) |
| Backward compatibility | None kept. Builds before this feature never update (P15) |
| Rollout / feature flag | On by default from the first build that has it; the setting of P9 is the only switch |
| Observability | Codes in the log; `ui.inspect`'s `update` part (P18); a failed release check fails the workflow run |
| Rollback | No way back to an older build from inside the app (P11). The engineer can stop offering a build only by releasing a newer one |

## Deferred
- OS code signing and notarization (D2): last on the roadmap.
- Links into the app (owner, 2026-11-23).
- Release notes shown in the app (P8): needs notes worth reading per build.
- A second channel (beta), a way back to an older build, forced updates, "skip this version" (P11).
- Partial (delta) downloads; downloading before the user clicks (D4).
- A native notification that an update exists: with the menus, notifications and tray work (D3).
- Updating the daemon, and telling the user that the app and the daemon no longer match beyond the
  existing notice: the single-binary daemon work (D3).
- A way for the engineer to withdraw an offered build without releasing a newer one.

## Open questions — TODO(verify)
- [ ] Does `restart()` after an install race with `tauri-plugin-single-instance` (the new process sees
  the old one and exits)? — owner: agent, in the spike or the first task
- [ ] Does adding the plug-in keep `aws-lc` out of `Cargo.lock` and pass the licence rule? — owner: agent
- [ ] macOS: does the keychain ask again after an update of an ad-hoc signed build, and once per item
  or once per launch? Not checkable without a Mac — owner: nobody (accepted, D2)
- [ ] macOS: does the swap of an ad-hoc signed `.app` in `/Applications` work without the
  quarantine warning returning? Not checkable without a Mac — owner: nobody
- [ ] How is the `.deb` path checked where no polkit agent runs (a container, a runner)? — owner: agent, in scope
- [ ] Does the NSIS installer install per user in our configuration, so an update needs no
  administrator prompt? — owner: agent, in scope
- [ ] What does the plug-in send with a check (headers), beyond the request itself? — owner: agent, in scope
- [ ] How the check of D8 makes a build prove it can update itself with the real key and the real
  files before the manifest moves, and how the app is pointed at a manifest that is not yet the
  offered one without shipping a switch that weakens the signature check — owner: agent, in scope
- [ ] How long the check of D8 adds to a release (estimate: 5 to 10 minutes) — owner: agent, measured
  in the first run
- [ ] Does an AppImage run on GitHub's Linux runner (FUSE), and does it rewrite itself there? — owner: agent
- [ ] macOS: an application the user never moved out of the Downloads folder runs from a read-only
  copy; is that reported as "cannot install in place" (P12)? Not checkable on a runner the way a
  user's install is — owner: nobody

No open question is blocking.

## Acceptance criteria (draft)
- [ ] Given a build A of the AppImage and a newer build B offered by the manifest, when the app
  starts, then `ui.inspect` and the connection bar show that B is available and nothing was
  downloaded; after the first click the progress is shown and then "Restart to update"; after the
  second the app is running again and shows version B.
- [ ] The same on a `.deb` install, with the system's password dialog between the click and the
  install; with `pkexec` absent or cancelled nothing is installed and the indicator links to the
  download.
- [ ] The same on GitHub's macOS machine from the `.dmg`'s application, and on GitHub's Windows
  machine from the NSIS installer.
- [ ] Given a file whose signature does not match, when the app installs, then nothing changes on
  disk, the app still runs as A, and the indicator shows the failure.
- [ ] Given no network, when the app starts, then it shows nothing about updates and logs one code;
  "Check for Updates…" says the check failed.
- [ ] Given the setting turned off, when the app starts and a day passes, then no request is made;
  "Check for Updates…" still checks.
- [ ] Given a running transfer, when "Restart to update" is clicked, then the close question is
  asked, and Cancel leaves the app running with the transfer intact.
- [ ] Given an install the app cannot update in place, when a newer build exists, then the
  indicator says so with the reason and a link, and no install is tried.
- [ ] Given a release whose check fails on one system, then the manifest still names the build
  before, the installers of the new build are published, and the workflow run is failed.
- [ ] Given a release whose check passes on the three systems, then the manifest names the new
  build, and a manifest built by the release job's script is read by the plug-in's own types in a test.
- [ ] The browser client shows no update indicator and looks as before (seen in a browser).
- [ ] No command answer, log line or `ui.inspect` part holds the private key; the list of commands
  the page may call is unchanged; `cargo xtask ci` passes with no `aws-lc` package.
- [ ] `desktop/docs/development.md` § Releasing holds the key's runbook (where it is, lost, leaked).

## Round log
| Round | Theme | Summary |
|-------|-------|---------|
| 0 | recon | Read the release workflow, the Tauri configuration, the updater plug-in's source (2.14.1), the command and webview rules, the host contract. Found: the plug-in installs `.deb` and `.rpm` too (the exploration record said it could not); carried D1–D3 from the engineer's earlier answers; wrote P1–P6 |
| 1 | problem, outcome & scope | The two users run the `.dmg`, the NSIS installer, the AppImage and the `.deb`. D4 notify then one click; D5 shown in the window; D6 a release per merge stays, checked at launch and once a day; D7 `.deb`/`.rpm` in place through `pkexec` only. Consequence raised for round 2: two of the four installers in use (macOS, Windows) are on systems no live run here reaches |
| 2 | verification & the key | D8 the update is checked on the three systems on every release and a build is offered only when all pass; D9 the agent creates the key, no password, repository secret plus one file on the engineer's machine. The agent then filled the happy path, data, integration points, edge cases, constraints and acceptance from the two rounds and the recon, and wrote P8–P18 for the readout. Themes 3 to 8 were not asked as rounds: the engineer asked to be spared low-impact questions, so they are proposals |

## Handoff to scope
(Drafted before the readout; valid once the status is `grilled`.)

| Spec file to produce | Fed by brief sections |
|----------------------|-----------------------|
| `swe/features/desktop-self-update.md` (new) | Goals, Non-goals, Happy path, Decisions D1–D9, Proposals P1–P18, Data & state, Edge cases, Non-functional constraints, Acceptance criteria, Open questions |
| `swe/architecture/workbench-host-adapter.md` (amend) | Data & state (the optional host member), Integration points |
| `swe/architecture/single-binary-daemon.md` (amend) | Integration points (the `.deb`/`.rpm` statement; the app's self-update is no longer "designed, not tried" once built) |
| `docs/desktop-client-handoff.md`, `swe/features/desktop-native-host.md`, `swe/MAIN-SCOPE.md` (amend) | Decisions D2, D3; Non-goals |
