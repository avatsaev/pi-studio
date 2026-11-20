# Task 004 — Rust: native confirm and alert, and opening links outside the app

- **Sprint:** sprint-104-desktop-dialogs-links-save
- **Status:** in_progress
- **Type:** feature
- **Area:** desktop/crates/shell, desktop/apps/pistudiodesktop/src-tauri
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** sprint-103/task-002

## Goal
The page can ask Rust for a native confirm or alert and can ask it to open a link in the system's default application, with the link checked in Rust first.

## Context / why
D9 and D26. A link in a message is written by an agent, so what reaches Rust is untrusted: only `http`, `https` and `mailto` may leave the app. Plug-ins are used from Rust; the page gets no plug-in permission.

## Scope references
- `swe/features/desktop-native-host.md` § Dialogs, § External links, § Public contract 5 (rows "Services", "Tauri commands for the page"), § Error handling (link rows, "confirm while the window is hidden")
- `desktop/crates/shell/src/services.rs` (`Services`: platform hooks injected by the app), `lib.rs`
- `desktop/apps/pistudiodesktop/src-tauri/src/` (`main.rs`, the page commands module, `services.rs`), `build.rs`, `capabilities/default.json`, `Cargo.toml`; `desktop/Cargo.toml`
- `desktop/ATTRIBUTION.md`, `desktop/AGENTS.md` golden rules 6 and 9

## What to build
- **Shell crate, pure and tested:**
  - link check: accepts a URL of at most 8,192 characters whose scheme is `http`, `https` or `mailto` (scheme compared without case); refuses everything else, including surrounding whitespace and control characters;
  - dialog text: at most 8,192 characters, longer text is cut with an ellipsis.
- **Service hooks** in `Services`: confirm (message → yes/no), alert (message), open a URL. Native implementations in the app: the dialog plug-in (titled with the product name, attached to the main window, bringing it forward) and the opener plug-in.
- **Page commands**, added to the app's command list and the capability file:
  | Command | Input | Answer |
  |---|---|---|
  | `dialog_confirm` | `{ message }` | `true` only for the affirmative button; closing the dialog is `false` |
  | `dialog_alert` | `{ message }` | nothing, once closed |
  | `open_external` | `{ url }` | nothing. A refused URL is ignored and logged with its scheme only |
- A dialog must not block the thread that owns the session nor the main thread: storage writes and the control socket keep working while it is open.

## Out of scope
- The frontend's host members (task-006).
- The save dialog (task-005).

## Acceptance criteria
- [ ] The link check accepts `https://example.com/a?b#c`, `HTTP://EXAMPLE.COM` and `mailto:a@b.c`.
- [ ] It refuses `file:///etc/passwd`, `javascript:alert(1)`, `data:text/html,x`, `tauri://localhost`, a URL with a leading space, the empty string and an 8,193-character URL.
- [ ] A 10,000-character message is cut to 8,192 characters ending in an ellipsis.
- [ ] With fake services in a shell test, a refused URL never reaches the open hook and an accepted one reaches it once, unchanged.
- [ ] The three commands are the only additions to the capability file; no plug-in permission is granted to the page.
- [ ] `cargo xtask ci` passes; the two plug-in crates' licences are on the allowlist.

## Test / verification plan
- `cargo test -p pistudiodesktop-shell`
- `cargo xtask ci` in `desktop/`
- The dialogs themselves are observed in task-008.

## Notes
- Depends on sprint-103/task-002 because the same app files change (`main.rs`, the command list, `Cargo.toml`).
- Spec TODO(verify): whether anything in the workbench relies on a dialog blocking the page's event loop. The 21 call sites already await; task-008 exercises several.
