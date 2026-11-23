# Task 003 — App binary: the check through the plug-in, the install kind, `--update-manifest`, the event and the menu dialog

- **Sprint:** sprints/sprint-132-desktop-update-app
- **Status:** backlog
- **Type:** feature
- **Area:** desktop/apps/pistudiodesktop/src-tauri
- **Priority:** P1
- **Estimated size:** M
- **Depends on:** task-002, sprint-131/task-001

## Goal
The app's `UpdaterHook` checks through the plug-in, knows its install kind and when it cannot install
in place, takes `--update-manifest`, tells the page with `update_changed`, and answers the menu item
with U11's dialog.

## Context / why
Spec § 6, § Behavior (check), U4, U9 (30 s), U10 (macOS menu), U11, U12, U13, P12.

## Scope references
- `swe/features/desktop-self-update.md` § 6, § Behavior & algorithms (check), U4, U11–U13
- New `desktop/apps/pistudiodesktop/src-tauri/src/update.rs` (+ tests); `main.rs` (`Args`, the hook in
  `Services`, timers), `menu.rs` (macOS item after About), `services.rs`

## What to build
- Kind from `tauri::utils::platform::bundle_type()`; macOS: `App` only when the executable is inside
  `*.app/Contents/MacOS`, else unknown.
- `cannot_install`: unknown kind → `development_build`; AppImage file or its directory not writable →
  `not_writable`; macOS path under `/Volumes/` or `AppTranslocation` → `read_only_location`;
  `deb`/`rpm` and no `pkexec` on PATH → `no_pkexec`.
- Check with the plug-in (`updater_builder().endpoints(..).timeout(30 s)`), target override for an
  unknown kind (U12). Map plug-in errors to `offline`, `manifest_invalid`, `no_target`.
- `--update-manifest <url>` (clap): passed to the endpoints; HTTPS enforced by the plug-in.
- Emit `update_changed` on every change; the menu click's dialog through the existing dialog hooks
  (Install runs `update.install`).
- Logs: codes, versions, kind only.

## Out of scope
Download, install, restart (task-004).

## Acceptance criteria
- [ ] Tests: kind detection and each `cannot_install` rule (paths injected); error mapping; the
  argument parsed and shown as `manifest: "override"`.
- [ ] Against a local manifest served over HTTP by a test build (overlay of sprint-131/task-001), a check
  finds a newer version and the state is `available`; equal or older → `up_to_date` (an integration
  test with a local server, or a scripted run recorded in the summary).

## Test / verification plan
- `cd desktop && cargo xtask ci`
