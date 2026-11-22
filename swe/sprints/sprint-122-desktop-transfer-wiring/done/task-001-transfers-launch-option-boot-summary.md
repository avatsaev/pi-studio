# Task 001 summary: `--transfers <engine|page>` and `boot.transfers`

`--transfers <engine|page>` is built: it defaults to `engine`, and the mode is kept in app state. `boot` now answers `transfers`, and `parseBootSnapshot` requires it. All gates passed, apart from two that need a note.

## Built
- **Mode type:** `TransfersMode` (`Engine` default, `Page`) lives in a new module, `shell/src/transfer_mode.rs`. It has a `FromStr` that names the bad value and an `as_str`.
- **App state:** `AppShell.transfers` holds the mode, and later tasks can read it there. `Launch.transfers` carries it from `main.rs` through `bridge::spawn_owner`.
- **Option:** `main.rs` has `--transfers` with `default_value = "engine"`. An unknown value fails the launch with clap's error, which names `--transfers`. There is no environment variable.
- **`boot`:** `page::boot` adds `"transfers"` to the answer.
- **Page side:** `parseBootSnapshot` requires `transfers` to be `"engine"` or `"page"`, and `BootSnapshot` has the field.
- **Fixtures:** every `Launch` literal in the tests carries the field, and the boot fixture in `boot.test.ts` carries `transfers`.
- **Docs:** `desktop/docs/control-protocol.md` (the launch options) and `desktop/docs/architecture.md` (the `boot` row) name the option and the field.

## Files changed
- Rust: `crates/shell/src/transfer_mode.rs` (new), `crates/shell/src/lib.rs`, `crates/shell/src/page.rs`, `src-tauri/src/main.rs`, `src-tauri/src/bridge.rs`.
- Rust tests: `src-tauri/src/commands/tests.rs`, `src-tauri/src/commands/tests/transport_tests.rs`.
- TypeScript: `src/host/boot.ts`, `src/host/boot.test.ts`.

## Commands run
- **`cargo test -p pistudiodesktop-shell -p pistudiodesktop`:** passed.
  - Tests added:
    - the mode parser;
    - `boot` answering `page` and `engine` (in `page.rs` and `commands/tests.rs`);
    - `Args` default and `--transfers page`;
    - `--transfers fast` failing with a message that names `--transfers`.
- **`cargo clippy -p pistudiodesktop-shell -p pistudiodesktop --all-targets -- -D warnings`:** clean.
- **`cargo fmt -p pistudiodesktop-shell -p pistudiodesktop`:** applied, and `cargo fmt --all -- --check` printed nothing.
- **In `apps/pistudiodesktop`:** `npm run check` and `npm run lint` are clean, and `npm test` passed (198 tests).
- **`npx oxfmt` on the two TypeScript files:** it matched no files, so I did not format them with it. This is probably an ignore rule; I did not check the config.

## Acceptance
- **`--transfers page` gives `boot.transfers === "page"`; no option gives `engine`; `--transfers fast` fails naming the option:** met, covered by the tests above.
- **A boot snapshot without the field, or with another value, is rejected by `parseBootSnapshot`:** met. The test table has the missing case and the `"fast"` case.
- **`cargo xtask ci` passes:** not run, as the context forbids it. The narrow gates above are green.

## Follow-ups
Nothing consumes `AppShell.transfers` yet. The commands and view of the later tasks read it there.

## Wave gate (orchestrator, combined tree)
```
npm run build -> ok; npm run typecheck -> ok; npm run lint -> 0 errors; npm test -> 296 files, 4211 tests passed
desktop frontend: npm run snapshot -> wrote snapshot.png, no CSP violation
cargo xtask ci (desktop/) -> all 8 steps passed (fmt, web, clippy, layers, test, panic_hunt, doctest, wasm)
```
