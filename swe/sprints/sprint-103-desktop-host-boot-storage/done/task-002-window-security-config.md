# Task 002 — Window and security configuration: drops, one instance, no navigation away

- **Sprint:** sprint-103-desktop-host-boot-storage
- **Status:** done
- **Type:** feature
- **Area:** desktop/apps/pistudiodesktop/src-tauri (+ desktop/crates/shell)
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** task-001

## Goal
Files dropped on the window reach the page as ordinary HTML5 drops, a second launch focuses the window that is open, and nothing can make the window load another site.

## Context / why
D6, D21 and the navigation rule. Tauri's own drop handling is on by default and, by its documentation, blocks HTML5 drops on Windows; the workbench's upload-by-drop uses HTML5 drops. A link or a script that navigates the main frame would replace the app with a web page that inherits the window.

## Scope references
- `swe/features/desktop-native-host.md` § Public contract 6, § Error handling (rows: page script navigates, second launch, dropped file); grill D6, D21
- `desktop/apps/pistudiodesktop/src-tauri/tauri.conf.json` (window `main`), `src/main.rs`, `Cargo.toml`, `desktop/Cargo.toml` (`tauri-plugin-*` versions move together)
- `desktop/crates/shell/src/` (a pure function belongs here, tested without Tauri)
- `desktop/ATTRIBUTION.md`, `desktop/AGENTS.md` golden rule 9

## What to build
- Turn the window's dropped-file handling off in `tauri.conf.json`.
- One instance: register the single-instance plug-in first; a second launch shows, un-minimises and focuses the main window, then exits.
- Navigation rule, decided by a pure function in the shell crate: the main frame may load only the app's own origin (its form differs per platform, and in a development build the dev server's origin is allowed too). Anything else is refused and logged with scheme and host only.
- Closing the window quits the app (Tauri's behaviour for one window): assert it, change nothing.

## Out of scope
- The confirm before closing with transfers running (sprint-104/task-007).
- Opening refused links in the system browser (sprint-104/task-004).

## Acceptance criteria
- [ ] The navigation function accepts the app origin on each platform's form and the dev origin only in a development build; it refuses `https://example.com`, `file:///etc/passwd`, `about:blank` and a look-alike host such as `tauri.localhost.evil.test`.
- [ ] `tauri.conf.json` has dropped-file handling off for `main`.
- [ ] Starting the app twice leaves one process, and the first window is focused.
- [ ] The new crate's licence is on the allowlist.
- [ ] `cargo xtask ci` passes.

## Test / verification plan
- `cargo test -p pistudiodesktop-shell` (navigation function).
- `cargo xtask ci`.
- Second launch and a scripted `location.href = "https://example.com"` are observed in the real webview in task-004.

## Notes
- Depends on task-001 because both edit `src/main.rs` and `Cargo.toml`.
- Where the navigation hook attaches (the window builder or a plug-in's hook) is the implementer's choice; the window is declared in `tauri.conf.json` today.
- Frames are not covered by this rule: the HTML preview's frame is sprint-105.
- Spec TODO(verify): HTML5 drops with the handling off on macOS and Linux. Linux is observed in task-004; macOS and Windows are in the platform checklist (sprint-106).
