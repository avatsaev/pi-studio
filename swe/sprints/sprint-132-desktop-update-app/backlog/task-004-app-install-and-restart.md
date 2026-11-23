# Task 004 — App binary: download, install (incl. `pkexec`), and restart

- **Sprint:** sprints/sprint-132-desktop-update-app
- **Status:** backlog
- **Type:** feature
- **Area:** desktop/apps/pistudiodesktop/src-tauri
- **Priority:** P1
- **Estimated size:** M
- **Depends on:** task-003

## Goal
`update.install` downloads and verifies (15 min limit), installs per kind, and `update.restart`
restarts after the close question; a `.deb`/`.rpm` installs through `pkexec` only; Windows runs the
installer at the restart.

## Context / why
Spec § Behavior (install, restart), D7, U7, U8, U9, P10, P13.

## Scope references
- `swe/features/desktop-self-update.md` § Behavior & algorithms, D7, U7, U8, P10, P13
- `desktop/apps/pistudiodesktop/src-tauri/src/update.rs`, `transfers.rs` (the close question:
  `close_decision` in `crates/shell/src/page.rs`), the quit path that saves state

## What to build
- Download through the plug-in with progress into `downloading{received,total}`; errors → `signature`,
  `download`, `offline`.
- AppImage, macOS app: plug-in `install(bytes)` → `restart_needed`.
- `deb`/`rpm`: write the bytes to a 0600 file in the cache dir; `pkexec dpkg -i` / `pkexec rpm -U`;
  remove the file in every case; exit 0 → `restart_needed`, 126/127 → `failed(refused)`, else
  `failed(install)`. Remove a leftover file at launch. The runner is injected so tests fake `pkexec`.
- Windows: keep bytes; at restart save state as quit does, then plug-in `install` (it ends the app).
- Restart: close question when transfers run (Cancel keeps everything); else `request_restart()`.
- Quitting in `restart_needed` drops kept bytes (Windows).

## Out of scope
The page's indicator (sprint 133); live runs (sprint-133/task-003).

## Acceptance criteria
- [ ] Tests: the `pkexec` exit-code mapping, the file's mode and removal in every path (fake runner);
  a signature failure leaves the state `failed(signature)` and nothing written; the restart refuses
  when the close question is answered no.
- [ ] `cargo xtask ci` passes; no unwrap/panic (`panic_hunt`).

## Test / verification plan
- `cd desktop && cargo xtask ci`
