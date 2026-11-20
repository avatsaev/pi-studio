# Task 005 — Live checks: preview scripts and isolation (Linux webview), and documents — Summary

- **Sprint:** sprint-105-desktop-html-preview-origin
- **Completed:** 2026-11-20
- **Status:** done (run by the orchestrator)

## What was checked
Desktop app (debug build at HEAD `7bc03a4`) in the `pi-desktop-xvfb` WebDriver container against a dev daemon, workspace `/tmp/live/ws/prev`. `boot` answered `preview: "origin"`.

1. **Scripts run:** `ran.html` showed "script ran" and a counter ticking. Frame src `pi-preview://localhost/<32 hex>`. Pass.
2. **Isolation** (`attack.html`): `parent.document` SecurityError; `localStorage` SecurityError; `__TAURI_INTERNALS__` undefined; `fetch('ipc://localhost/boot')` answered `500 missing Tauri-Invoke-Key header` (nothing ran); `window.open` returned `null`. App unaffected. Pass.
3. **Block remote resources:** off → remote image loaded, `fetch` opaque; on → image not loaded, `fetch` TypeError, IPC fetch TypeError. Pass.
4. **Preview → Source → Preview:** counter kept counting (19, not reset). Pass.
5. **Edit the file:** the dev daemon has no file watch, so live refresh could not be exercised; after editing on disk, **Reload** mounted a new URL showing "v2", and the old URL framed alone drew an empty page (404). Partial: auto-refresh untested.
6. **33 previews:** with 32 mounted, the 33rd showed "Error: 32 previews are already open; close one and try again"; 32 frames held `pi-preview:` URLs. Pass.
7. **Page reload:** a URL from before `location.reload()` drew an empty page (404). Pass.
8. **`npm run snapshot` (Chromium, browser host):** the plain snapshot reported no violation. With `attack.html` open, the browser host (no `preview` member, `srcdoc` under the app policy) drew the markup and the snapshot reported only that document's own inline script and remote image as blocked — the unchanged pre-sprint browser-host behaviour, no new violation of the app. Pass.

## Documents
- `desktop/docs/architecture.md`: "Known gap" replaced by how the preview is served, a per-platform table, `frame-src` row, `preview_mount`/`preview_release` rows.
- `swe/features/desktop-native-host.md` TODO(verify) D7: Linux in-app result added.
- `docs/desktop-client-handoff.md`: preview origin done; known-gap sentence removed.
- `swe/features/html-file-preview.md`: cross-reference to the desktop spec.

## Build & test results
- Root `npm run build`, `typecheck`, `lint`, `test` (291 files, 4127 tests): pass.
- `cargo xtask ci`: see wave gate below.

## Acceptance criteria
- [x] Checks 1–8 on Linux with evidence above (check 5's auto-refresh not exercisable on the dev daemon; Reload path verified).
- [x] Documents match the code; no document calls the preview scripts a known gap on Linux.
- [x] Spec's first TODO(verify) updated.
- [x] Gates pass.

## Follow-ups / TODO(verify)
- Auto-refresh of a preview after an on-disk edit against a production daemon (file watch).
- macOS and Windows measurement: sprint-106/task-002.
