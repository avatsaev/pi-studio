# Development

## Prerequisites

- **Rust** stable, 1.95 or newer, with `rustup component add clippy rustfmt` and
  `rustup target add wasm32-unknown-unknown`.
- **Node.js** 22.12 or newer (an even, LTS line), with npm.
- **Linux**: a C compiler, pkg-config, and the development packages Tauri builds against.

  | Distribution | Command |
  |---|---|
  | Debian, Ubuntu | `sudo apt install build-essential pkg-config libwebkit2gtk-4.1-dev librsvg2-dev libxdo-dev` |
  | Fedora, RHEL | `sudo dnf install gcc pkgconf-pkg-config webkit2gtk4.1-devel librsvg2-devel libxdo-devel` |
  | Arch | `sudo pacman -S gcc pkgconf webkit2gtk-4.1 librsvg xdotool` |

- **Windows**: the MSVC toolchain with the "Desktop development with C++" workload, and the
  WebView2 runtime (part of Windows 11 and of current Windows 10).
- **macOS**: the Xcode command line tools.
- **Optional**: `cargo install cargo-nextest --locked` (the parallel test runner; without it the
  gate falls back to `cargo test`).

Then, once: `npm ci` at the repository root. The frontend is an npm workspace of the monorepo, so
there is one lock file and one install, both up there.

## Commands

| Command | What it does |
|---|---|
| `cargo run -p pistudiodesktop` | Run the desktop app with the built frontend. Add `--release` for anything performance-sensitive |
| `npm run app` (in `apps/pistudiodesktop`) | Run the desktop app on Vite's dev server: frontend changes reload at once |
| `cargo xtask web` | The frontend: type check, lint, tests and build (`npm ci` at the repository root first when needed) |
| `npm run check` / `npm run lint` / `npm test` (in `apps/pistudiodesktop`) | `tsc -b` (also builds the type declarations of the monorepo packages it imports) / oxlint (type-aware; warnings are errors) / the tests (vitest) |
| `cargo test -p <crate> --lib --tests` | One crate's tests, skipping examples and doctests |
| `cargo test -p <crate> --test <file>` | One integration-test file |
| `cargo nextest run --workspace` | Every Rust test, in parallel across test binaries |
| `cargo clippy -p <crate> --all-targets -- -D warnings` | Lint what you touched |
| `cargo fmt --all` | Format |
| `cargo xtask layers` | Print the dependency table and any violations |
| `cargo xtask wasm` | `cargo check` for wasm32 on the layered crates |
| `cargo xtask ci` | The whole gate. Run it before you call something done |
| `npm run bundle` (in `apps/pistudiodesktop`) | Build installers with the Tauri bundler |

The gate runs, in order: `fmt`, `web`, `clippy`, `layers`, `test`, `panic_hunt`, `doctest`, `wasm`.

The frontend is embedded into the desktop binary at compile time, from `apps/pistudiodesktop/dist`. Any cargo
command that compiles the app (`cargo run -p pistudiodesktop`, `cargo clippy --workspace`) needs that
directory: run `cargo xtask web` (or `npm run build`) first, and again after frontend changes.

## Releasing

Installers are built by `.github/workflows/desktop-release.yml` (at the repository root), not on a
developer's machine. The desktop client has its own version, `[workspace.package] version` in
`Cargo.toml`; it does not follow the npm packages' version.

1. Set the version in `Cargo.toml`, run `cargo xtask ci` (it refreshes `Cargo.lock`), merge to `main`
   and wait for the Desktop CI run of that commit to pass.
2. Tag that commit `desktop-v<version>` and push the tag. A tag that does not match the version
   fails the run before anything is built.
3. The workflow builds on three runners and creates a **draft** GitHub Release with the installers:
   `.deb`, `.rpm` and `.AppImage` (x64), one universal `.dmg`, and `.msi` plus an NSIS `.exe` (x64).
4. Download and try each installer, write the notes, then publish the draft on GitHub.

To build the installers without releasing, run the workflow by hand (Actions → Desktop release → Run
workflow): they are attached to the run as artifacts. A pull request that changes the workflow file
does the same, which is how a change to it is tested.

The installers are not signed with a real identity. macOS gets an ad-hoc signature, so a downloaded
app must be allowed in System Settings → Privacy & Security; Windows shows a SmartScreen warning.
Real signing needs an Apple Developer ID and a Windows code-signing certificate, held as repository
secrets.

## Run the pieces

The CLI:

```sh
cargo run -q -p pistudiodesktop-cli -- commands --filter settings
cargo run -q -p pistudiodesktop-cli -- run --cmd settings.get
cargo run -q -p pistudiodesktop-cli -- run --config-dir ./cfg --cmd 'settings.set {"key":"autoStartLocalDaemon","value":false}' --cmd settings.get
```

`commands` lists the registry, one JSON object per line. `run` executes each `--cmd '<id> [json]'`
in order and prints `{"command": …, "result": …}` per step. With `--config-dir DIR` the session
reads and writes that configuration directory (`settings.json`, `daemon-state/<entry>.json`);
nothing is created until a command writes, so the third line leaves `./cfg/settings.json` behind.
Without it the session lives in memory and writes no file.

Results are JSON lines on standard output; diagnostics go to standard error. Exit status 1 is a
failed command, 2 a usage error.

The UI without the app. `npm run snapshot` serves the built frontend from a loopback port with the
app's Content-Security-Policy, draws it in a headless browser and saves a PNG. It exits 1 when the
page broke the policy or threw, so it is also the check for a change to the policy.

```sh
cd apps/pistudiodesktop
npm run snapshot:install        # once: downloads the headless browser
npm run build
npm run snapshot -- --out ui.png                       # the window before it connects
npm run snapshot -- --out ui.png --wait-for 'text=/^connected/i' \
  --query 'host=127.0.0.1:6767&connect=1'              # connected to a daemon on this machine
```

`--query` is the workbench's launch grammar (`host`, `password`, `cwd`, `connect=1`). `--steps FILE`
runs an ES module's default export, `async (page) => {}`, with the Playwright page before the
screenshot: open a workspace, send a message, open a file. A daemon to point it at:
`PI_STUDIO_LISTEN=127.0.0.1:6790 npm run dev:daemon` at the repository root (a mock agent, no
credentials).

This is how to check a UI change without opening a window. The browser is Playwright's Chromium
(or `--browser webkit`), not the platform webview the app runs in: trust it for layout, themes and
the policy, and check platform behaviour in the running app.

The running app, driven from outside: see `docs/control-protocol.md`.

## Environment variables

| Variable | Effect |
|---|---|
| `PISTUDIODESKTOP_LOG` | `trace`, `debug`, `warn` or `error`: the level for Pi Studio's own crates (default `info`). Other crates log at `warn` |
| `PISTUDIODESKTOP_CONTROL_PORT` | Same as `--control <port>` |
| `PISTUDIODESKTOP_CONTROL_TOKEN_FILE` | Same as `--control-token-file <file>` |
| `PISTUDIODESKTOP_CONFIG_DIR` | Same as `--config-dir <dir>`: the configuration directory |
| `CARGO_PROFILE_DEV_DEBUG=true` | Full debug info for one build, to inspect local variables in a debugger |

## Configuration directory

The app keeps its files in `--config-dir <dir>` (or `PISTUDIODESKTOP_CONFIG_DIR`), else the
platform's app configuration directory — on Linux `~/.config/com.avatsaev.pi-studio`. It holds
`settings.json` (the app settings, with the workbench's app-wide keys under `workbench`),
`daemons.json` (the daemon registry: the entries, with a direct entry's password or a relay entry's
pairing link, and `lastUsedId`; mode 0600, never sent to the page) and `daemon-state/<id>.json`
(the keys kept per daemon; `local` for this machine, the entry's id for the others). A file that
cannot be read is renamed to `<name>.corrupt-<time>`, the app starts with defaults and the page
shows the notice once. Point `--config-dir` at a scratch directory for tests and smoke runs.

### Pointing the app at a scratch CLI and home

The local daemon is run through the `pi-studio` CLI. Set `cliPath` (`settings.set`, or the Daemons
screen) to a script of your own to choose which CLI runs, for example one that execs the repository's
build: `exec node <repo>/packages/cli/dist/cli.js "$@"` (after `npm run build:cli`). The CLI inherits
the app's environment, so start the app with `PI_STUDIO_HOME=<scratch dir>` to keep the daemon's state
out of `~/.pi-studio`, and set `autoStartLocalDaemon` to `false` before the first launch, or the app
starts a daemon on launch. `daemon start` always listens on 6767 (`PI_STUDIO_LISTEN` does not apply),
so nothing else may hold that port. A fake CLI for failure cases is
`crates/shell/tests/fixtures/fake-pi-studio.sh` (modes in its header). Quitting the app leaves the
daemon it started running: stop it with `pi-studio daemon stop` under the same `PI_STUDIO_HOME`.

## Without a display

Running the window needs a display: `Xvfb :99 -screen 0 1280x800x24 &` and then
`DISPLAY=:99 cargo run -p pistudiodesktop`. The snapshot tool and every test need none.

The `pi-desktop-xvfb` Docker image (Xvfb, WebKitGTK and WebKitWebDriver; no `nc`) runs the built
app with no display of your own. After `cargo build -p pistudiodesktop` (which needs
`apps/pistudiodesktop/dist`), mount the workspace read-only and talk to the control socket from
inside the container. Pick a scratch port other than 6767, which a daemon may use:

```sh
cat > /tmp/pi-smoke.sh <<'EOF'
cd /work
xvfb-run -a ./target/debug/pistudiodesktop --control 7979 --control-token-file /tmp/control.token >/tmp/app.log 2>&1 &
sleep 6
TOKEN=$(tr -d '\r\n' < /tmp/control.token)
exec 3<>/dev/tcp/127.0.0.1/7979
printf '%s\n' "{\"id\":\"auth\",\"method\":\"auth\",\"params\":{\"token\":\"$TOKEN\"}}" \
  '{"id":1,"method":"ui.inspect","params":{}}' >&3
for i in 1 2; do read -t 5 -u 3 line; echo "$line"; done
EOF
docker run --rm -v "$PWD:/work:ro" -v /tmp/pi-smoke.sh:/tmp/pi-smoke.sh:ro pi-desktop-xvfb bash /tmp/pi-smoke.sh
```

Expected: `{"id":"auth","ok":true,"result":{"authenticated":true}}`, then
`{"id":1,"ok":true,"result":{"daemons":{"currentId":"local","entries":[{"hasPassword":false,"id":"local","kind":"local","name":"This machine"}],"local":{"state":"cli_missing"},"settings":{"autoStartLocalDaemon":true,"cliPath":null}},"menus":[…],"settings":{…},"ui":{…}}}`
(the image has no `pi-studio` CLI, hence `cli_missing`).
This checks that the app starts and answers; for the window's pixels use `npm run snapshot`, and
for the webview itself WebKitWebDriver, as below.

To drive the real webview on Linux without a display, run the binary under WebKit's WebDriver
(`WebKitWebDriver`, Ubuntu package `webkitgtk-webdriver`) with `TAURI_WEBVIEW_AUTOMATION=true` in
its environment, and open a session with the capabilities `{"browserName": "wry",
"webkitgtk:browserOptions": {"binary": "<path to pistudiodesktop>", "args": ["--config-dir",
"<scratch dir>"]}}`. Scripts, clicks and screenshots then go through the WebDriver protocol; from
an async script, `window.__TAURI_INTERNALS__.invoke('boot')` shows what the page booted with.

Three things the container does not give you by default:

- **A D-Bus session bus.** Without one the single-instance check never runs and a second launch
  opens a second window. Start one before WebKitWebDriver:
  `dbus-daemon --session --fork --print-address=3 3>/tmp/bus` and export
  `DBUS_SESSION_BUS_ADDRESS=$(cat /tmp/bus)`.
- **A window manager.** There is none, so focus cannot be observed, and closing the WebDriver
  session kills the app (no exit flush). To close it like a user, send `WM_DELETE_WINDOW` to the
  window `xwininfo -root -tree` lists as "Pi Studio" (an `XSendEvent` `ClientMessage`).
- **One app at a time.** The single-instance lock is per app identifier, not per configuration
  directory: two sessions at once collide.

## Platform checks on macOS and Windows runners

`apps/pistudiodesktop/scripts/platform-checks.mjs` (helpers in `scripts/platform-checks/`, run by `.github/workflows/desktop-platform-checks.yml`) checks on a runner what a machine can check; `docs/platform-checks.md` says which items it covers. Modes: `macos` (the control socket only), `windows` (WebDriver through `tauri-driver` and `msedgedriver`) and `rehearse-webdriver`, which runs the Windows checks on Linux against a `WebKitWebDriver` already listening (the container of § Without a display), so the script can be tried without a Windows machine. It writes `summary.md` and `results.json`, appends the summary to `GITHUB_STEP_SUMMARY` and exits 1 when a check fails. Its unit tests run with the app's `npm test`.

## Debugging the frontend

In a debug build, right-click in the window and choose "Inspect Element" for the webview's
developer tools. Release builds have them off.
