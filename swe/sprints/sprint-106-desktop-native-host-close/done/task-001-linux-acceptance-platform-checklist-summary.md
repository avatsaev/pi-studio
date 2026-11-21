# Task 001 — Linux acceptance run and the platform checklist — Summary

**Sprint:** sprint-106-desktop-native-host-close · **Completed:** 2026-11-20 · **Status:** done. No criterion failed on Linux; two could not be run in the headless container and stay open for a real desktop.

## Linux pass over `desktop-native-host.md` § Acceptance criteria
Run on the final tree (`pi-desktop-xvfb` container, WebKitGTK, X-display input). "Cited" means nothing changed since the summary named; later work was re-checked where it could have broken the item.

| # | Criterion | Result | Evidence |
|---|---|---|---|
| 1 | Workbench mounted with a desktop host; browser host only for the members marked | pass | sprint-103/task-004; the page boots through `boot`; `localStorage` empty (2) |
| 2 | Layout restored after quit and start; webview storage holds none of the keys | pass | split a pane, quit, start again: 2 panes back from `daemon-state/local.json`; `Object.keys(localStorage)` is `[]` (this run) |
| 3 | Entries A and B keep separate layouts; a theme change on A applies on B | pass | sprint-110/task-007 checks 5 (1, 2, 3 panes kept apart; theme in `settings.json`). The bug found there (layout written to the entry switched to) is fixed |
| 4 | Corrupt `settings.json`, `daemons.json` or state file: defaults, `*.corrupt-<time>`, one notice each | pass | this run: three files corrupted; three notices on the page (screenshot), three `*.corrupt-20261120T211837Z` files, `daemons.json.corrupt-*` mode 0600, registry reset to the local entry, no notice on a second boot |
| 5 | Delete confirmation is native; declining keeps the file | pass | this run (native dialog, Cancel, `readme.txt` still there); sprint-104/task-008 |
| 6 | Session rename is an in-app dialog in the desktop app and the web client; Escape changes nothing; no `dialogs.prompt` | pass | cited: sprint-104/task-008 checks 8 and 10 |
| 7 | `https` link opens the system browser, window stays; web client opens a new tab | pass | cited: sprint-104/task-008 checks 3 and 11 |
| 8 | `file:` and `javascript:` links open nothing | pass | cited: sprint-104/task-008 check 3 (the app log of this series also shows both refused) |
| 9 | 1 GiB download: native dialog, byte-identical, memory flat | pass | sprint-104/task-008 (6.5 s, SHA-256 equal, 738 → 854 MiB); repeated in sprint-110/task-007 check 13, SHA-256 equal |
| 10 | Cancelled or failed save leaves no file or temporary file | pass | cited: sprint-104/task-008 check 5 and the save tests |
| 11 | A file dragged from the OS onto the explorer uploads (Linux, macOS, Windows) | **not run** | the container has no desktop to drag from; a page-dispatched HTML5 drop uploads (sprint-103/task-004). Open for a real Linux desktop and for macOS/Windows: checklist N4 |
| 12 | Preview with `origin`: script runs; command channel, parent, popup fail; "Block remote resources" blocks | pass | cited: sprint-105/task-005 (Linux). macOS and Windows: not measured, stay `inert` (checklist N11) |
| 13 | `inert`: notice and markup | pass | cited: sprint-105/task-004 tests and the Chromium snapshot (browser host) |
| 14 | Window closed during a transfer: native confirm, "no" keeps the app | pass | cited: sprint-104/task-008 check 7 (`WM_DELETE_WINDOW`); the switch variant in sprint-110/task-007 check 13 |
| 15 | Second launch focuses the first window, one process | pass | this run: a second `pistudiodesktop` started with the same identifier exited 0; one process and one "Pi Studio" window |
| 16 | `doc`, `ops`, `format` crates and item/undo/file commands gone; `cargo xtask ci` passes; `ui.inspect` returns the registry view without secrets | pass | `cargo xtask ci` all 8 steps; `ui.inspect` output in `desktop/docs/control-protocol.md` (sprint-109/task-006) |
| 17 | Window capability grants only the app's own commands | pass | `capabilities/default.json`: the fifteen `allow-*` permissions plus `core:event:allow-listen`/`allow-unlisten` |
| 18 | Web client build and tests pass; only the rename dialog and external links changed | pass | workbench tests (1,720 passed), root `tsc -b`; a browser shows the unchanged connection bar (sprint-110/task-007 check 16) |

## TODO(verify) with a result
- **Clipboard in the webview** (the one check no earlier task made): "Copy Absolute Path" put `/tmp/live/ws/readme.txt` on the X `CLIPBOARD` selection (`xclip -selection clipboard -o`). Linux: pass; macOS and Windows: checklist N12.
- Upload picker in WebKitGTK and the save dialog's starting folder in a container without XDG directories: still unverified here (no portal); checklist N3 and N6.
- The close-time layout flush (a change in the last ~250 ms before closing is lost) is unchanged; checklist N10.

## `desktop/docs/platform-checks.md`
Written: a "Get the app" section (manual Desktop release run, unsigned installers, a scratch `--config-dir`), a native-host table (N1–N12) and a registry table (R1–R8) each with steps and the expected result, a results table, and the automated-workflow section.

## Gates
`cargo xtask ci`: 8 steps passed.
