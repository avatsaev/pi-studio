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
| `npm run check` / `npm run lint` / `npm test` (in `apps/pistudiodesktop`) | `tsc --noEmit` / oxlint (type-aware; warnings are errors) / the component tests (vitest) |
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

## Run the pieces

The CLI:

```sh
cargo run -q -p pistudiodesktop-cli -- run --new Groceries --cmd 'item.add {"text":"milk"}' --out list.pistudiodesktop
cargo run -q -p pistudiodesktop-cli -- info list.pistudiodesktop
cargo run -q -p pistudiodesktop-cli -- commands --filter undo
```

Results are JSON lines on standard output; diagnostics go to standard error. Exit status 1 is a
failed command, 2 a usage error.

The UI without the app. `npm run snapshot` draws the real frontend in a headless browser and saves
a PNG. The view it draws comes from the real shell, after the control-protocol calls in `--script`.

```sh
cd apps/pistudiodesktop
npm run snapshot:install        # once: downloads the headless browser
npm run build
npm run snapshot -- --out ui.png --size 720x420 \
  --script '[["engine.execute", {"command": "item.add", "params": {"text": "milk"}}], ["ui.set", {"theme": "light"}]]'
```

This is how to check a UI change without opening a window. The browser is Playwright's Chromium
(or `--browser webkit`), not the platform webview the app runs in: trust it for layout and themes,
and check platform behaviour in the running app.

The same view as JSON, without any browser:

```sh
cargo run -q -p pistudiodesktop-shell --example view -- --script '[["ui.set", {"theme": "light"}]]'
```

The running app, driven from outside: see `docs/control-protocol.md`.

## Environment variables

| Variable | Effect |
|---|---|
| `PISTUDIODESKTOP_LOG` | `trace`, `debug`, `warn` or `error`: the level for Pi Studio's own crates (default `info`). Other crates log at `warn` |
| `PISTUDIODESKTOP_CONTROL_PORT` | Same as `--control <port>` |
| `PISTUDIODESKTOP_CONTROL_TOKEN_FILE` | Same as `--control-token-file <file>` |
| `CARGO_PROFILE_DEV_DEBUG=true` | Full debug info for one build, to inspect local variables in a debugger |

## Without a display

Running the window needs a display: `Xvfb :99 -screen 0 1280x800x24 &` and then
`DISPLAY=:99 cargo run -p pistudiodesktop`. The snapshot tool and every test need none.

## Debugging the frontend

In a debug build, right-click in the window and choose "Inspect Element" for the webview's
developer tools. Release builds have them off.
