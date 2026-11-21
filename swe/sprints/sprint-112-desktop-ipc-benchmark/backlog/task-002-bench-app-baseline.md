# Task 002 — Benchmark application: scaffold, local WebSocket server, baseline workloads

- **Sprint:** sprint-112-desktop-ipc-benchmark
- **Status:** backlog
- **Type:** feature
- **Area:** desktop/apps/ipc-bench
- **Priority:** P1
- **Estimated size:** M
- **Depends on:** none

## Goal
A small Tauri application that runs the benchmark's workloads over the page's own `WebSocket` and writes the numbers to a file, unattended.

## Context / why
This is the measuring instrument for the gate, and the baseline it produces is what the app does today (the webview's socket). The candidates are added in task-004. It stays in the repository so the gate can be measured again after a Tauri upgrade or for another design, but it is never bundled or released.

## Scope references
- `swe/features/desktop-transport-bridge.md` § 1 (the application, rows B1–B6), § 8
- `desktop/Cargo.toml` (workspace members), `desktop/xtask/src/layers.rs` (`TABLE`: register it as `Exempt`)
- `desktop/apps/pistudiodesktop/src-tauri/` (how the shipped app is laid out; nothing in it changes)
- `.github/workflows/desktop-release.yml` (must keep building only the shipped app)
- `desktop/docs/development.md` (the `pi-desktop-xvfb` container)

## What to build
- A new workspace member, `apps/ipc-bench`, with its own `tauri.conf.json`, capability and page. The page is static files with no npm package (`withGlobalTauri`), so the root `package-lock.json` does not change.
- Rust side: a WebSocket server on `127.0.0.1` with a free port and three behaviours chosen by the path: echo; flood (N frames of a given size and kind, each carrying a counter, with a running hash sent at the end); sink (counts and hashes what it receives, then reports).
- Page side: a workload runner written against a small transport interface (connect, send text, send binary, on message, close, buffered amount), with one implementation over `WebSocket` (`binaryType = "arraybuffer"`). Workloads B1 to B5 as the spec's table defines them; every workload checks B6 (counter order and hash).
- Options: `--out <file>` for `results.json`, `--runs <n>` (default 3), `--only <rows>`, `--scale <fraction>` to shrink the byte counts for a quick run. The app exits 0 when every run completed and B6 found nothing, 1 otherwise.
- `results.json`: per workload and run, the raw measurements (durations, bytes, frames, percentiles), the platform, the webview's user agent and the Tauri version.
- A server switch that corrupts or swaps one frame, used to prove that B6 notices.

## Out of scope
- The bridge candidates (task-004), rows B7 and B8 (task-005), the workflow (task-006).
- Any command, permission or dependency added to `apps/pistudiodesktop`.

## Acceptance criteria
- [ ] In the `pi-desktop-xvfb` container the application runs to the end without a person and writes `results.json` with rows B1–B5 for the baseline, three runs each.
- [ ] With the corrupting switch on, the run exits 1 and names the workload and the frame.
- [ ] `cargo xtask ci` passes with the new member; the layer check lists it as exempt.
- [ ] The shipped app's capability-list test and `tauri.conf.json` are unchanged, and `desktop-release.yml` still bundles only `pistudiodesktop`.
- [ ] `desktop/docs/development.md` says how to run it.

## Test / verification plan
- `cargo xtask ci` in `desktop/`
- Run in the container with `--scale 0.1`, then once at full scale; attach both `results.json` files to the summary.

## Notes
- Licences: every new crate must be permissive (`desktop/AGENTS.md` rule 9). `tokio-tungstenite` is MIT (checked on crates.io, 2026-11-21); check the rest when adding them.
- Never crash applies here too: no unwrap, expect or panic outside tests.
- Build it in release mode for measurements; a debug build is only for trying it.
