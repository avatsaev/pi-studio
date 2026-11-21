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
2. Try the installers before tagging: run the workflow by hand (see below) and install what it
   attaches. Nothing checks them after the tag.
3. Tag that commit `desktop-v<version>` and push the tag. A tag that does not match the version
   fails the run before anything is built.
4. The workflow builds on three runners and **publishes** a GitHub Release with the installers:
   `.deb`, `.rpm` and `.AppImage` (x64), one universal `.dmg`, and `.msi` plus an NSIS `.exe` (x64).
   It is public at once, with fixed notes (the unsigned-build warnings and the CLI the local daemon
   needs); edit the notes on GitHub afterwards. If a bundle job fails, no release is created.

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
cargo run -q -p pistudiodesktop-cli -- run --config-dir ./cfg --secret-store file --cmd 'settings.set {"key":"autoStartLocalDaemon","value":false}' --cmd settings.get
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
`daemons.json` (the daemon registry, version 2: the entries, `hasPassword` for an entry that has a
secret in the secret store, and `lastUsedId`; mode 0600, no secret in it) and `daemon-state/<id>.json`
(the keys kept per daemon; `local` for this machine, the entry's id for the others). A file that
cannot be read is renamed to `<name>.corrupt-<time>`, the app starts with defaults and the page
shows the notice once. Point `--config-dir` at a scratch directory for tests and smoke runs.

**Where the secrets go.** `--secret-store keychain|file` (the app and its CLI): without it the app
takes the operating system's keychain when it answers within 2 s and accepts a throwaway item
(written and deleted at launch), else `secrets.json` in this directory (mode 0600), and the page says
so once (a notice) and on the Daemons screen. `file` never touches the keychain; `keychain` on a
machine without one fails the launch with a message that names the option. **Every automated or
live run passes `--secret-store file` with a scratch `--config-dir`**, so that nothing writes to a
developer's keychain: the commands in this document do, and so does
`apps/pistudiodesktop/scripts/platform-checks` (`SECRET_STORE_ARG`, checked by a unit test). The
keychain's items are named by the directory as it is given (a hash of the path; the default
directory is `default`), so the CLI sees the app's keychain secrets only when `--config-dir` names
the app's directory the same way, and not at all for the app's default directory: use
`--secret-store file` on both or neither.

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
`DISPLAY=:99 cargo run -p pistudiodesktop -- --secret-store file` (the option keeps the run's secrets
out of your keychain; § Configuration directory). The snapshot tool and every test need none.

The `pi-desktop-xvfb` Docker image (Xvfb, WebKitGTK and WebKitWebDriver; no `nc`) runs the built
app with no display of your own. After `cargo build -p pistudiodesktop` (which needs
`apps/pistudiodesktop/dist`), mount the workspace read-only and talk to the control socket from
inside the container. Pick a scratch port other than 6767, which a daemon may use:

```sh
cat > /tmp/pi-smoke.sh <<'EOF'
cd /work
xvfb-run -a ./target/debug/pistudiodesktop --control 7979 --control-token-file /tmp/control.token --secret-store file >/tmp/app.log 2>&1 &
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
"<scratch dir>", "--secret-store=file"]}}`. Scripts, clicks and screenshots then go through the WebDriver protocol; from
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

### The keychain in the container

`crates/secrets/tests/keychain_live.rs` checks the real keychain on Linux. Its tests are `#[ignore]`d: an ordinary `cargo test` never writes to a keychain. Each item they write has a scope of its own (a hash of a scratch path) and is removed again. The default image has no Secret Service, which is what the second test wants; the first needs a derived image with GNOME Keyring and `secret-tool` (not added to the default image):

```sh
mkdir -p /tmp/pi-keyring-img /tmp/pi-live && cd /tmp/pi-keyring-img
printf 'FROM pi-desktop-xvfb:latest\nRUN apt-get update && apt-get install -y --no-install-recommends gnome-keyring libsecret-tools && rm -rf /var/lib/apt/lists/*\n' > Dockerfile
docker build -t pi-desktop-keyring:latest .
cd <repo>/desktop && cargo test -p pistudiodesktop-secrets --test keychain_live --no-run   # prints the binary's path
cp <that binary> /tmp/pi-live/keychain_live
cat > /tmp/pi-live/with-keyring.sh <<'EOF'
set -e
eval "$(printf 'test-password' | gnome-keyring-daemon --unlock --components=secrets 2>/dev/null)"   # creates and unlocks the login keyring
sleep 1
eval "$(gnome-keyring-daemon --start --components=secrets 2>/dev/null)"   # serves it on the session bus
sleep 1
/tmp/pi-live/keychain_live --ignored --test-threads=1 set_get_and_delete --nocapture
EOF
# with a Secret Service: set, get, delete, and `secret-tool lookup service com.avatsaev.pi-studio username <scope>/<entry id>/<kind>` sees the item
docker run --rm -v /tmp/pi-live:/tmp/pi-live:ro pi-desktop-keyring dbus-run-session -- bash /tmp/pi-live/with-keyring.sh
# without one (default image; with a bus that nobody answers on, and with no bus): the probe says `unavailable` within 2 s
docker run --rm -v /tmp/pi-live:/tmp/pi-live:ro pi-desktop-xvfb dbus-run-session -- /tmp/pi-live/keychain_live --ignored --nocapture the_probe_without
docker run --rm -v /tmp/pi-live:/tmp/pi-live:ro pi-desktop-xvfb /tmp/pi-live/keychain_live --ignored --nocapture the_probe_without
```

Order matters in the keyring script: with the daemon started first, or `--unlock` alone, the `login` collection is missing or locked and every write fails (`denied`) or waits for a prompt that has no display. In the derived image a bus activates GNOME Keyring on its own, so its probe succeeds even without the script: the probe reads an item and cannot tell a locked or missing `login` collection (a later `set` then fails with `denied`).

**The secret store in the real webview** (checked on Linux 2026-11-21, sprint-113/task-008). Copy the built binary to a private directory, give the container the host's network and your user (`--user $(id -u):$(id -g)`, so that the scratch files stay yours), mount a scratch directory as `/scratch` and run, inside it, a D-Bus session bus (§ above), for the keychain case the unlock-then-start sequence of `with-keyring.sh`, an explicit `Xvfb :99 &` (under `--user`, `xvfb-run` never starts its command) and `TAURI_WEBVIEW_AUTOMATION=true WebKitWebDriver --port=<free> --host=127.0.0.1`. A Node script on the host then drives it with `scripts/platform-checks/webdriver.mjs` (`Session.open(base, webkitCapabilities({application, args: ["--config-dir", "/scratch/cfg"]}))`; the app takes no `--secret-store` when the choice itself is under test) and `page-ui.mjs`. `session.invoke("boot")` shows `secretStore`; `session.invoke("engine_command", {id: "daemon.add", params})` is what the page calls for the daemon commands; the keychain is read with `docker exec -e DBUS_SESSION_BUS_ADDRESS=$(cat /scratch/bus) <container> secret-tool search --all service com.avatsaev.pi-studio`. A direct entry that connects needs a daemon on the host with `PI_STUDIO_PASSWORD` (`PI_STUDIO_HOME` scratch, `PI_STUDIO_LISTEN=127.0.0.1:<port>`); a relay entry needs `node packages/relay/dist/relay-main.js` (`PI_STUDIO_RELAY_LISTEN`), the daemon with `PI_STUDIO_RELAY_ENABLED=true`, `PI_STUDIO_RELAY_ENDPOINT=127.0.0.1:<port>`, `PI_STUDIO_RELAY_USE_TLS=false`, and the link from `PI_STUDIO_HOME=… node packages/cli/dist/cli.js --json daemon pair` (same relay variables). Use ports from the OS (never 6767) and remove the containers and processes after.

## The IPC benchmark

`apps/ipc-bench` is the measuring instrument of the transport bridge's gate (`swe/features/desktop-transport-bridge.md` § 1). A small Tauri app: its page (`page/`, plain ES modules, no npm package and no entry in the root `package-lock.json`) runs the workloads against a WebSocket server in the same process, on `127.0.0.1` and a free port, and Rust writes `results.json` and exits. It is a workspace member, exempt from the layer rules, with its own `tauri.conf.json`, capability and fourteen commands (`bench_config`, `bench_rss`, `bench_progress`, `bench_finish`, `bench_window_hold`, `bench_tick_start`, `bench_tick_stop` and the seven `bridge_*` ones below); it depends on the `net` crate (codec, inbound window, outbound order buffer); it is never bundled or released and the shipped app has nothing of it. Rows B1 to B5 (B2 with 4 KiB, 64 KiB and 256 KiB frames) run over three transports in `page/transport.js`: the page's own `WebSocket` (the baseline), and two candidate bridges, `bridge-frame` and `bridge-batch`. B6 (order and integrity) is checked in every workload of every transport. W1 (`--only window`) is the candidates' no-acknowledgement test: the page never acknowledges a 128 MiB flood, Rust must stop reading just past the 8 MiB window (the bytes it holds stop there and the server's sends stall), then the page acknowledges and the flood must arrive whole. B7 and B8 (`page/load.js`, below) run on all three transports.

**The candidates** (`src/bridge.rs`, `src/bridge_commands.rs`, `page/bridge.js`, `page/batch.js`): Rust holds a client socket to the benchmark's own server and forwards between it and the page. Inbound goes over a Tauri `Channel`: `bridge-frame` sends one channel message per WebSocket message (raw for binary, JSON for text), `bridge-batch` sends batches in the `net` codec's format, flushed when 64 KiB is waiting or the socket has nothing more to read right now. Outbound goes through commands shaped like the spec's: `bridge_open` (`url`, `inbound`, a `Channel`), `bridge_send_text` (`handle`, `seq`, `data`), `bridge_send_binary` (a raw body with the headers `handle` and `seq`), `bridge_ack`, `bridge_close`, plus `bridge_send_batch` (a raw body in the codec's format under one `seq`) and `bridge_stats` (the counters of a connection). `bridge-frame` sends one invoke per frame; `bridge-batch` sends the frames queued in the same task as one raw invoke. In both, the `net` crate's `InboundWindow` counts the payload bytes sent and the page acknowledges every 256 KiB or 50 ms (stop reading above 8 MiB, resume below 4 MiB), and the `OrderBuffer` puts sends back in `seq` order before the write task writes them; the write task flushes once per queued group and answers each send after the flush. The page's `bufferedAmount` adds a frame's bytes at send and subtracts them at the send's answer. The socket is plain and local: no TLS, password or error classes, and the order buffer's 5 s gap timer and the 16 MiB byte cap of the spec are not part of the benchmark (a gap shows as a run that times out).

The server picks its behaviour by path: `/echo`; `/flood?frames=N&size=S&kind=binary|text` (waits for the text `go`, then sends N frames and a closing JSON message with the count and the running hash); `/mixed?frames=N&size=S` (a binary `/flood` that also echoes, between two frames, every message the page has sent, and keeps echoing after the closing message until the page closes: B7); `/paced?rate=R&seconds=T&size=S` (after `go`, `R` binary frames a second for `T` seconds in 10 ms ticks, a late tick making up what is due, then the flood's closing message: B8); `/sink` (checks what it receives, answers a report on the text `end`). Every frame carries its counter and a checksum, every stream a running hash (`src/frame.rs`, mirrored in `page/frame.js`; the same vectors are tested in both).

```sh
cargo build --release -p pistudiodesktop-ipc-bench      # measure only with a release build
cargo run --release -p pistudiodesktop-ipc-bench -- --out /tmp/results.json --scale 0.1
node --test 'apps/ipc-bench/page/*.test.mjs'            # the page's half: frame format, batch codec, bridge transport, comparison
```

| Option | Effect |
|---|---|
| `--out FILE` | Where `results.json` goes (default `results.json` in the current directory) |
| `--runs N` | Runs of each workload (default 3) |
| `--only ROWS` | A comma-separated subset of `b1,b2,b3,b4,b5,window,b7,b8` (`window` is the candidates' no-acknowledgement test; the baseline skips it) |
| `--scale F` | Shrink every count and byte total to the fraction `F` (above 0, at most 1): `0.1` is a quick run |
| `--corrupt N` | The server changes a byte of frame N of each stream it sends (and of what it receives): the run must exit 1 and name the workload and the frame |
| `--swap N` | The server sends frame N after frame N+1 (on `/sink` it checks the frame it received as N after N+1); `/echo` answers one frame at a time and cannot |
| `--timeout S` | Give up with exit 1 after S seconds (default 3600) |

The app runs unattended and exits 0 when every run completed and B6 found nothing, 1 otherwise; the problems are printed as `PROBLEM <transport> <workload> run <n>: frame <k>: …`. The reading of the baseline against the candidates is printed at the end as `PASS`/`FAIL` lines. In the `pi-desktop-xvfb` container (see § Without a display; mount a writable directory for the results):

```sh
mkdir -p /tmp/ipc-bench && cat > /tmp/ipc-bench/run.sh <<'EOF'
cd /work
xvfb-run -a ./target/release/ipc-bench --out /out/results.json "$@"
EOF
docker run --rm -v "$PWD:/work:ro" -v /tmp/ipc-bench:/out pi-desktop-xvfb bash /out/run.sh --scale 0.1
```

`results.json` (`schema` 2) holds the platform, the webview's user agent, the Tauri version, the options, the timer's step and, per transport, every run's raw measurements (durations, bytes, frames, percentiles, the memory samples of B4, the integrity result, and for a candidate the `ipc` record of the run) and a `summary` with the worst and the median run of each metric. For a candidate, `ipc` (per transport: `ipc`) says which way raw bodies reached Rust (`custom protocol (raw bytes)`, or `postMessage (JSON array)` when Tauri fell back after one failed fetch), how many sends arrived out of `seq` order (and the most frames that waited for an earlier one), how many channel messages Tauri evaluated into the page and how many the page fetched (a raw message under 1,024 bytes and a JSON one under 8,192 are evaluated), the most bytes unacknowledged, and the window's numbers. `comparison` is a first reading of each candidate against the baseline with the pass column of the spec's § 1 (a `pass: false` row is a finding, not a failed run: only an incomplete run or a damaged frame makes the exit code 1). Four things to read it with:

- The page's timer (`performance.now()`) steps by 1 ms in WebKit: a round trip under 1 ms reads 0 or 1. B1's `medianMs` and `p99Ms` are quantized by it; `meanMs` (the total over the trips) is not. `timerResolutionMs` says what the page saw.
- Every check (counter, checksum, running hash) costs the page the same in every transport: `pageHash.mibPerS` says how fast the page hashes.
- B4's memory is the sum of the resident memory of the app and its descendants (`/proc` on Linux, `ps` on macOS, PowerShell on Windows), sampled every 250 ms (at least once a second) from before the run to after it: `memory.samples` holds every sample, `growthKiB` is the peak minus the start. On macOS the web content process is not a child of the app, so read `processesAtStart` before trusting the total. Only Linux has been run.
- B5's `bufferedAmountEnd` is read once the answers of the last sends have arrived (waiting at most 2 s; `settleMs` says how long it took): through a bridge the sink's report can overtake them. `bufferedAmountAtReport` is the number at the report itself.

**B7 and B8** (`page/load.js`, `page/hidden.js`, `page/worker-timers.js`, `src/tick.rs`, `bench_window_hold` in `src/commands.rs`).

- **B7** runs B1's echo (32-byte frames, one at a time, 5 warm-up trips not counted) on the same connection while B4's download (1 GiB as 32 KiB frames, `/mixed`) runs, until the download's closing message. The record has the trips, the mean, median, 90th and 99th percentile, the maximum and the 20 slowest round trips, and the download's own rate; both streams are checked (B6). It is reported only: one socket is shared, as in the app today. WebKit's timer steps by 1 ms, so the 99th percentile is quantised; the baseline finishes the download in a second or so, so its trip count is small (`trips`).
- **B8** runs `/paced` at 1,000 frames a second of 4 KiB for the hidden period plus 2 s (30 s hidden at full scale, 2 s at least when scaled), twice per transport: `B8/hide` (`window.hide()` then `show()`) and `B8/minimise` (`minimize()` then `unminimize()`). Rust does the whole hold (`bench_window_hold`): a hidden page may run late or not at all, so it cannot be the one that shows the window again. The record has `lostFrames` (the stream's own count less the page's; B6 names each missing frame), `heldBytes` (Rust's most unacknowledged bytes, `null` for the baseline: the webview's own buffers cannot be read) against the window (8 MiB and a frame: more is a problem and fails the run), `framesDeliveredWhileHidden` and `framesBehindAtShow` (the page's deliveries against the stream's clock), `catchUpMs` (from the show until the page is within 100 frames of the stream), `window` (what the system said after each request, and the `visibilitychange` events the page saw: `systemHidIt`, `pageSawHidden`), `workerTimer`, `pageTimer` and `rustTick`. The two timers are chains of 500 ms timers, each armed when the last fired (as the app's reconnect timers are): the worker one is the source of `packages/workbench/src/host/browser-worker-timers.ts` (a test fails when `page/worker-timers.js` drifts from it), the page one is `setTimeout`; each reports `expectedFires` and `firedWhileHidden` (a stopped timer fires nothing) and `maxDelayMs`, the lateness of the fires that were due while the window was away (also when they fired after it came back, and for the timer still waiting at the end). `rustTick` is a 2 s tick on the Rust side (`src/tick.rs`) over the whole run: `maxGapMs` is its longest sleep and `maxDelayMs` how much later than 2 s that was; the wake detector of the app's connection resilience uses such a tick. The timers and the tick decide nothing here: the note reports them and the owner decides P7.
- Under Xvfb a hidden window is not a real desktop's: with no window manager `minimize()` is accepted and does nothing (`window.afterHide.minimized` stays false, `pageSawHidden` false), and WebKitGTK keeps running a hidden page's timers and deliveries, so the page never falls behind and the window bound is not stressed (W1 is the test of the bound). The runners and a real machine are the evidence for P7. To minimise under a window manager in the container, derive an image (`FROM pi-desktop-xvfb:latest`, `RUN apt-get update && apt-get install -y --no-install-recommends openbox`) and start it before the benchmark: `xvfb-run -a bash -c 'openbox & sleep 1; exec ./target/release/ipc-bench "$@"' _ --out /out/results.json`.

**On the macOS and Windows runners** (`.github/workflows/desktop-ipc-benchmark.yml`): builds `ipc-bench` in release mode on `macos-15` and `windows-latest` and runs it with `--runs` and `--scale` (no npm install, no WebDriver, no machine policy). Start it from Actions → Desktop IPC benchmark → Run workflow (inputs `runs`, default 3, and `scale`, default 1), or by a pull request that changes the workflow file (a quick run: 1 run, scale 0.1). A workflow file that exists only on a branch cannot be started by hand (`gh workflow run` answers 404), so the first run needs such a pull request or the file on `main`; pushing a branch and opening a pull request need the owner's word. It never runs on a push to `main`, and `release.yml` ignores `desktop/**` and `.github/workflows/desktop-*.yml`. Results: the job summary (runner CPU model, core count, OS, webview version, the user agent, a table of the summary rows and the PASS/FAIL comparison) and an artifact per platform, `ipc-benchmark-macos` and `ipc-benchmark-windows`, with `results.json` and `bench.log`. A job fails only when the application exits non-zero; the thresholds are read by a person.

## Platform checks on macOS and Windows runners

`apps/pistudiodesktop/scripts/platform-checks.mjs` (helpers in `scripts/platform-checks/`, run by `.github/workflows/desktop-platform-checks.yml`) checks on a runner what a machine can check; `docs/platform-checks.md` says which items it covers. Modes: `macos` (the control socket only), `windows` (WebDriver through `tauri-driver` and `msedgedriver`) and `rehearse-webdriver`, which runs the Windows checks on Linux against a `WebKitWebDriver` already listening (the container of § Without a display), so the script can be tried without a Windows machine. It writes `summary.md` and `results.json`, appends the summary to `GITHUB_STEP_SUMMARY` and exits 1 when a check fails. Its unit tests run with the app's `npm test`.

## Debugging the frontend

In a debug build, right-click in the window and choose "Inspect Element" for the webview's
developer tools. Release builds have them off.
