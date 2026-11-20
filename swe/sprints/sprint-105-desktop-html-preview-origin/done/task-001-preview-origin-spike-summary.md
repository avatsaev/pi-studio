# Task 001 — Spike: a sandboxed frame served from a custom scheme — Summary

- **Sprint:** sprint-105-desktop-html-preview-origin
- **Completed:** 2026-11-20
- **Status:** done — Linux measured: works ("origin"). Run by the orchestrator.

## What was done
Temporarily registered a `pi-preview` scheme in the app (header `Content-Security-Policy: sandbox allow-scripts`, `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`), added `frame-src` to the window policy, and loaded a probe page in `<iframe sandbox="allow-scripts">` from the real WebKitGTK webview under WebDriver. Variants: with/without the sandbox attribute, with/without the response header, with/without the "Block remote resources" tag. The experiment was reverted with `git checkout` of `main.rs` and `tauri.conf.json`.

## Findings (details in `swe/notes/desktop-preview-origin-spike.md`)
- Scripts run; the frame has an opaque origin; parent access, `localStorage` and popups are blocked; `__TAURI_INTERNALS__` is absent.
- **The navigation rule refused the frame** (`navigation refused: pi-preview://localhost`): WebKitGTK runs Tauri's `on_navigation` for subframes. Task-003 must admit the preview scheme in `shell::navigation::allows`.
- With the blocking tag off, `ipc://localhost/<cmd>` from the frame answers `500 missing Tauri-Invoke-Key header` — the invoke key is the barrier. Task-003 must test that the frame cannot invoke.
- The response header alone sandboxes the document (a frame without the attribute got the same isolation).
- The blocking tag blocks a remote image and fetch; without it both load.

## Files
- `swe/notes/desktop-preview-origin-spike.md` (new): answers, per-platform table, minimal shape, repeat procedure, probe page.
- `swe/features/desktop-native-host.md` § TODO(verify): first entry updated with the Linux result.

## Build & test results
- `cargo xtask ci`: all 8 steps passed after the revert; `git status` showed only the task-file move and the notes.

## Acceptance criteria
- [x] Questions 1–5 answered for Linux with observations.
- [x] Per-platform table (Linux measured; macOS, Windows not measured).
- [x] Repeatable procedure and probe page included.
- [x] No experiment code left; `cargo xtask ci` passes.

## Follow-ups
- Task-003: admit the scheme in the navigation rule; test the frame cannot invoke; `frame-src pi-preview:`.
- sprint-106/task-002: run the procedure on macOS and Windows.
