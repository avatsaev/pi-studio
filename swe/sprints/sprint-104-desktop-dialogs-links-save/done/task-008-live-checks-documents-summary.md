# Task 008 — Live checks (Linux webview + browser) and documents — Summary

- **Sprint:** sprint-104-desktop-dialogs-links-save
- **Completed:** 2026-11-20
- **Status:** done — checks 1–8, 10, 11 pass; check 9 recorded; one product fix (unsafe links reloaded the app). Run by the orchestrator.

## Setup
App built from the tree after tasks 001–007, copied to `/tmp/live`, run under WebKitWebDriver in `pi-desktop-xvfb` (`--network host`, Xvfb `:99`, D-Bus session bus, `PATH` starting with `/tmp/live/bin` whose `xdg-open` records its arguments). Native dialogs driven from the host through XTest (keys, clicks), `XSetInputFocus` (no window manager) and `import -window root` screenshots. Dev daemon on 6790; web client `vite` dev server on 5191 in omp's Chromium.

## Checks
|#|Check|Result and evidence|
|---|---|---|
|1|Delete confirm|Native GTK dialog "Permanently delete this file? "dropped.txt" — this cannot be undone." Cancel → file kept; OK → deleted. While it was open, `boot` (owner thread) answered at once. The app was not started with `--control`, so the owner-thread round trip stood in for `settings.get` over the socket|
|2|Alert|Native "Pi Studio" message dialog (OK only), closed, the app continued (`dialog_alert` resolved). Triggered via the page command; "Copy path" (the only reachable alert path) succeeded instead of failing|
|3|Links|Clicking `https://example.com/a?b=1` in a mock message → recorder got exactly that URL, window still `tauri://localhost`. `file:` and `javascript:` links call nothing (also `open_external` with either: nothing recorded). **Found:** the markdown renderer blanks them to `<a href="">`, and clicking one **reloaded the app**. Fixed (below) and re-checked: they render as plain text, no reload|
|4|1 GiB save|Native save dialog → `/tmp/live/dl/big.bin`. SHA-256 `b0a1fcdd…acbfb` equals the source. **6.5 s** (~160 MiB/s). App processes (Rust + WebKit) RSS 738 MiB before, **854 MiB peak** — flat|
|5|Cancel save dialog|Escape → no file, no message|
|6|Daemon stopped mid-save|`.part` existed; after killing the daemon it was removed, no destination file, native alert "Failed to download: connection is not open"|
|7|Close during a save|`WM_DELETE_WINDOW` → native "1 file transfer is still running. Quit anyway?"; Cancel → app kept running and the save completed with the right SHA-256|
|8|Rename session|In-app "Rename session" dialog (input focused), Enter renamed the row to "Renamed one"|
|9|Upload button|Clicked with XTest: **nothing opened** (no new window) in this container (no WM, no portal). Recorded in the spec TODO(verify); recheck on a real desktop|
|10|Web rename dialog|Opens with the input focused and prefilled; Escape closes; Enter with a new name renames ("Web renamed"); focus returns to the session row|
|11|Web links|`https://example.com/x` opened a new tab with that URL; `#top` changed the hash only, no new tab, no reload|

## Product fix
`<a href="">` (what react-markdown leaves for unsafe URLs) reloaded the whole app in both clients. `timeline/external-href.ts#classifyExternalHref` now returns `"none"` for an empty href and `FileLink` renders the label as `<span>`. Test updated (`external-href.test.ts`). Verified in the desktop webview and the browser.

## Documents
`desktop/docs/architecture.md` (Services hooks; the page's command table with what each validates; saves and journal), `desktop/AGENTS.md` (where it stands, rule 6), `desktop/SECURITY.md` (links, saves), `desktop/docs/control-protocol.md`, `packages/workbench/AGENTS.md` (empty-href rule; host rows for `saveTarget`, dialogs without `prompt` and external links were updated with tasks 001–003), `docs/desktop-client-handoff.md` status row, spec TODO(verify) entries (clipboard, async dialogs, file input, save start folder, throughput).

## Build & test results
- Root: `npm run build`, `typecheck`, `lint`, `test` — pass (291 files, 4127 tests).
- `cargo xtask ci`: all 8 steps passed.

## Acceptance criteria
- [x] Checks 1–8, 10, 11 pass with evidence.
- [x] Check 4 memory flat (+116 MiB peak for 1 GiB); 6.5 s recorded.
- [x] Check 9 observation recorded.
- [x] Documents match the code.
- [x] Gates pass.

## Follow-ups / TODO(verify)
- Upload button in WebKitGTK on a real desktop (sprint-106 checklist); if no picker, a native open-file command.
- Save dialog started at `/` in the container (no XDG user dirs); Downloads expected on a desktop.
- Close-time layout flush (sprint-103 finding) still open.
