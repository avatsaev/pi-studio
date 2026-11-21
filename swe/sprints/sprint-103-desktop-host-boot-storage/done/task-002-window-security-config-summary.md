# Task 002 — Window and security configuration — Summary

- **Sprint:** sprint-103-desktop-host-boot-storage
- **Completed:** 2026-11-20
- **Status:** done. `cargo xtask ci` passes all 8 steps. I did not run the real-webview checks.

## What was implemented
- `tauri.conf.json`: `dragDropEnabled: false` on window `main`.
- `tauri-plugin-single-instance = "2"` added to the workspace and the app crate. It is registered first in `main.rs`. A second launch calls `focus_main_window`, which shows, un-minimises and focuses `main`. The second process then exits.
- New `desktop/crates/shell/src/navigation.rs` with a pure `allows(url, dev_origin)` and `describe(url)`, which returns scheme and host only for logging.
  - `allows` accepts `tauri://localhost`, `http(s)://tauri.localhost` (no port), and the dev origin when one is passed.
  - The parser is hand-written, so the shell crate gets no `url` dependency. It rejects user info, a port on the app origin, look-alike hosts and anything without a `scheme://` authority.
- Hook: a `navigation_guard()` plug-in in `main.rs` using `on_navigation`. It passes `build.dev_url` only when `tauri::is_dev()` is true. A refused navigation is logged as a warning with `describe`.
- Close = quit: I changed nothing and left a comment in `main.rs`. No test asserts it.

## Files
| File | Change |
|---|---|
| `desktop/crates/shell/src/navigation.rs` | new, with 4 unit tests |
| `desktop/crates/shell/src/lib.rs` | `pub mod navigation;` |
| `desktop/apps/pistudiodesktop/src-tauri/src/main.rs` | single-instance plug-in, navigation guard, focus function |
| `desktop/apps/pistudiodesktop/src-tauri/tauri.conf.json` | `dragDropEnabled: false` |
| `desktop/apps/pistudiodesktop/src-tauri/Cargo.toml`, `desktop/Cargo.toml`, `desktop/Cargo.lock` | new dependency |

## Acceptance
- [x] The navigation function accepts the app origin in each platform's form, and the dev origin only when one is passed. It refuses `https://example.com`, `file:///etc/passwd`, `about:blank` and `tauri.localhost.evil.test`. Verified by the unit tests, which ran inside `cargo xtask ci`.
- [x] `dragDropEnabled: false` is set for `main`. I read it in the config file only.
- [ ] Starting the app twice leaves one process with the first window focused. Not run here; the task defers it to task-004.
- [x] The plug-in's licence: it has the same dual MIT/Apache-2.0 licence as the other Tauri plug-ins. I did not check its licence file. There is no `deny.toml` and no licence allowlist in `xtask`, so nothing was edited. `ATTRIBUTION.md` lists assets only, so no row was added.
- [x] `cargo xtask ci` passes (fmt, web, clippy, layers, test, panic_hunt, doctest, wasm).

## Follow-ups
- **Smoke tests:** the single-instance lock is keyed by the app identifier. Two instances launched with different `--config-dir` values will collide, so parallel smoke or control-socket tests need to account for that.
- **Task-004:** observe in the real webview that a second launch focuses the first window, and that `location.href = "https://example.com"` is refused. Check Linux HTML5 drops there too.
- **TODO(verify):** the navigation plug-in hook only covers webview navigations. Frames are out of scope (sprint-105).

## Proposed doc edits
- `desktop/AGENTS.md`: add that `shell::navigation::allows` is the only navigation rule, that the single-instance plug-in must stay first in the builder, and that drag-drop is off in the window config because the page uses HTML5 drops.
- `desktop/SECURITY.md`: add the navigation rule row (app origin only, plus the dev origin in dev builds, logged with scheme and host only) and the single-instance behaviour.

## Wave gate (orchestrator)
```
Wave gate: cargo xtask ci all 8 steps passed; frontend npm run check / lint / test (18) passed; npm run snapshot drew the workbench with the browser host (viewed /tmp/ui103.png). Desktop doc edits carried into sprint-103/task-004.
```
