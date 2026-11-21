# Task 004 — Live checks in the real webview (Linux) and documents — Summary

- **Sprint:** sprint-103-desktop-host-boot-storage
- **Completed:** 2026-11-20
- **Status:** done — checks 1–8 pass; check 9 recorded (close loses the last change, fix proposed); documents updated. Run by the orchestrator.

## Setup
Binary built from the tree after tasks 001–003 and copied to `/tmp/live`. `pi-desktop-xvfb` container with `--network host`, Xvfb `:99`, a D-Bus session bus, WebKitWebDriver on 4445; sessions open the app with `--config-dir /tmp/live/cfg`. Dev daemon `PI_STUDIO_LISTEN=127.0.0.1:6790` with `PI_STUDIO_HOME=/tmp/live/home`; workspace `/tmp/live/ws`.

## Checks
|#|Check|Result and evidence|
|---|---|---|
|1|Layout survives a restart|Opened `/tmp/live/ws`, new tab, Split right → `daemon-state/local.json` gained `"kind":"split"` + 2 leaves. New session (new process), reconnected: two panes drawn (screenshot), read from that file|
|2|No workbench keys in the webview's `localStorage`|`Object.keys(localStorage)` → `[]` before and after the restart|
|3|Theme lands in `settings.json` under `workbench`|The workbench has no theme control, so `storage_set('pi-studio-appearance', …)` was invoked from the page; 1.6 s later `settings.json` held `"workbench": {"pi-studio-appearance": "{\"mode\":\"light\",…}"}`|
|4|Corrupt `settings.json`|Replaced with `garbage{`; start → toast "settings.json could not be read and was reset. The old file was kept as settings.json.corrupt-20261120T194240Z."; the file exists; after `location.reload()` no notice|
|5|Second launch|With a D-Bus session bus: second process exited 0 at once, one process remained. Focus not observable (no window manager). Without a bus the second launch keeps running — documented|
|6|`location.href = "https://example.com"`|Still `tauri://localhost`, workbench drawn|
|7|Unlisted command|`plugin:dialog\|open` → "dialog.open not allowed…"; `control` → "control not allowed. Command not found"|
|8|HTML5 drop on the file explorer|`DragEvent` drop with a `File` on the explorer container → `/tmp/live/ws/dropped.txt` created with the content `dropped!`|
|9|Change then close within 250 ms|**Reload:** Split down then `location.reload()` → split kept (leaves 3 → 4). **Close:** Split down, `WM_DELETE_WINDOW` 27 ms later → split lost (leaves stayed 3). Control: the same split with no close is written 2 s later|

## Finding (check 9)
The page's `pagehide` flush does not reach Rust before the app exits on a window close, so a layout change made within the 250 ms workbench debounce is lost. Recorded in `swe/features/desktop-native-host.md` § TODO(verify). Proposed fix, not done: on `CloseRequested`, hold the close, have the page flush (run the `pagehide` handlers, then `storage.settled()`), close on answer or after a short timeout.

## Documents changed
- `desktop/docs/architecture.md` § The webview boundary: the two commands, the enforced list, flush timing, navigation, drops, single instance.
- `desktop/docs/control-protocol.md`: "Not from the webview".
- `desktop/docs/development.md`: `PISTUDIODESKTOP_CONFIG_DIR`, § Configuration directory, WebDriver `args`, D-Bus / window-manager / single-instance notes.
- `desktop/AGENTS.md`: "Where it stands", golden rule 6.
- `desktop/SECURITY.md`: webview bullet. `desktop/docs/contributing.md`: step 6 (no `menus::invoke`).
- `docs/desktop-client-handoff.md`: status row. Spec TODO(verify) entries for drops, `pagehide`, configuration directory.

## Build & test results
- `cargo xtask ci`: all 8 steps passed on this tree (run at the wave gate before the checks).

## Acceptance criteria
- [x] Checks 1–8 pass with evidence (above).
- [x] Check 9 recorded; loss on close noted in the spec TODO(verify) with a proposed fix.
- [x] The documents match the code.
- [x] `cargo xtask ci` passes.

## Follow-ups / TODO(verify)
- Close-time flush (above) — needs a task; not in sprints 104–111 as planned.
- The connection URL is not kept across restarts with the desktop host (launch is null); the daemon registry (sprints 109–110) replaces it.
- A real desktop drag and the second-launch focus need a desktop with a window manager.
