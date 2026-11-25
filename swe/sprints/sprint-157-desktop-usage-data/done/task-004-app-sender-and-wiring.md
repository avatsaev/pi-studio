# Task 004 — App binary: the PostHog sender and its moments

- **Sprint:** sprints/sprint-157-desktop-usage-data
- **Status:** done
- **Type:** feature
- **Area:** desktop/apps/pistudiodesktop/src-tauri
- **Priority:** P1
- **Estimated size:** M
- **Depends on:** task-002

## Goal
A published build sends `app_started` after setup, `app_daily` from the hourly tick and the wake
signal, and `app_closed` (≤ 2 s) at exit or before "Restart to update"; any other build sends nothing.

## Context / why
Spec § 1, § 2, § 8, U1–U3, U10, U11, D14, D15, P1, P9, P10.

## Scope references
- `swe/features/desktop-usage-data.md` § 1, § 2, § 4, § Behavior & algorithms, § Error handling
- Create `desktop/apps/pistudiodesktop/src-tauri/src/usage.rs`; modify `main.rs` (setup wiring, the
  `app.run` loop's `on_run_event` list, the blocked inputs from `Args` and the environment),
  `update.rs` (the restart hand-over calls the close path first; the hourly ticker and
  `on_wake` also tick usage), `src-tauri/Cargo.toml`, `desktop/Cargo.toml` (`sys-locale`)
- Reference: `desktop/crates/install/src/download.rs` (the `reqwest` client with `rustls`/`ring` and
  the platform verifier), `logging.rs` (log rule), `resume.rs` (wake)

## What to build
- Constants: `TOKEN = option_env!("PISTUDIODESKTOP_POSTHOG_TOKEN")`; endpoint
  `option_env!("PISTUDIODESKTOP_USAGE_ENDPOINT")` else the EU constant; `test_build` = the override is set.
  An empty token counts as none.
- The `usage` `Services` hook: one `POST` with § 2's headers, the given limit (10 s, 2 s at close),
  success = `200` and the event's result `ok`/`warning`; else a code `offline | timeout | status_<n> | dropped`.
  Build the client as `install` does (share a constructor from `install` if that is the smaller change).
- Inputs: `os` from `cfg!(target_os)`, `std::env::consts::ARCH`, `CARGO_PKG_VERSION`, the install kind
  from `update::Env::detect()`, `sys_locale::get_locale()` (U11), registry counts by `Kind` from the shell.
- Moments: launch after setup on a background task (the window never waits); the update ticker's
  hourly loop and the wake hook call `on_tick` off their thread; `RunEvent::Exit` and the update
  restart call `on_close` and send blocking with 2 s. A second launch never reaches setup (P9).
- Logging: `log::debug!("usage: not sent ({code})")` only; never the URL, ID, token or a value.
- `sys-locale` licence checked and recorded as rule 9 of `desktop/AGENTS.md` asks.

## Out of scope
The workflow variable (task-006), the page (task-005).

## Acceptance criteria
- [x] A build without the token reports `blocked: "build"` in `ui.inspect` and makes no request.
- [x] Unit tests of the response classification (200 ok, 200 drop, 401, 5xx, connection refused, timeout)
  against a local test server in the crate's tests.
- [x] `cargo xtask ci` passes (layers: no `aws-lc-rs`; clippy; tests).

## Test / verification plan
- `cd desktop && cargo fmt --all && cargo xtask ci`
- End-to-end in the container is sprint-158/task-001.

## Notes
TODO(verify) from the spec: whether `RunEvent::Exit` fires on "Restart to update" on Linux/macOS —
the once flag of task-002 makes it harmless either way; record what was seen.
