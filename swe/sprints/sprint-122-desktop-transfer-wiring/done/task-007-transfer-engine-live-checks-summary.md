## Task 007 — Transfer engine live checks — Summary

- **Status:** every Behaviour row of the spec was checked live. No defect needed a fix, and I changed no code.
- **Gates:** `cargo xtask ci` passed all 8 steps. At the root, `npm run build`, `typecheck` and `lint` exit 0, and `npm test` passes 296 files and 4211 tests. The lint warnings are `no-underscore-dangle` ones in files I did not touch.
- **Isolation:** I used scratch dirs under `/tmp`, free ports 17801–17813, `--secret-store file` and a throwaway container. `~/.pi-studio`, port 6767 and the keychain were not touched. I removed the container, processes and scratch dir afterwards.

## How it ran
- **App:** the freshly built debug binary, run in `pi-desktop-xvfb` under WebKitWebDriver, with `PISTUDIODESKTOP_LOG=debug`.
- **Daemon:** the production daemon with a password and `HOME=<scratch>`. Without that, the explorer's root is the daemon's real home directory and uploads land there.
- **Throttling and cutting:** a small TCP proxy sat between the app and the daemon. It throttled the bulk connection, cut only that connection, and could point at a closed port.
- **Native dialogs:** the open dialog ("Open File") was driven with `xdotool`, so uploads were started through the real native picker. The save dialog and the native confirm and alert dialogs were driven the same way. The window was closed with a `WM_DELETE_WINDOW` message sent through python-xlib.

## Behaviour rows
All were seen, except the two noted in the last row.

- **Second client, and 30 s after:**
  - During a transfer the daemon lists a second `browser` client with `platform: "desktop"`, `agentStreams: "none"` and `appVersion: "pistudiodesktop/0.2.0"`.
  - Its disconnect came with code 1000 after 50 319 ms, for a 20 363 ms save: 29.9 s idle.
- **Four transfers:**
  - Three ran and one was `queued: 1`, with the line `Downloading dl4.bin… waiting`. It started when one ended.
  - The three lines were `Uploading 2 files… 49%`, `Downloading dl2.bin… 51%` and `Downloading dl3.bin… 10%`, each with `Cancel: …`.
  - The batch's two files went one after the other.
  - All five hashes matched.
- **Save and temp file:**
  - During the save only `.pistudio-save-<hex>.part` existed.
  - Afterwards only the destination existed, with the right hash.
  - The destination's time is the time of the save, not the daemon file's.
- **Cancelled save:** nothing left, `Download cancelled`.
- **Cancelled and failed uploads:**
  - Cancelling an upload over an existing 20-byte file left its old content, no `.part`, and `Upload cancelled`.
  - A source that grew by 5 bytes mid-upload gave `Upload failed: The file changed while it was being uploaded.` and `lastError {code: "source_changed"}`, with nothing on the daemon.
  - A picked name that did not exist (`source_unreadable`) also left nothing.
- **Cut connection:**
  - Save: after the cut the save went to `waiting`, then resumed 0.4 s later from byte 15 990 784 with `restarts: 1`. Hash equal.
  - Upload: `bytesDone` went back to 0 and the daemon held no temp file and no target while waiting. It then restarted as a new temp file. Hash equal.
- **Daemon stopped:**
  - The line said `waiting for the connection`. A save continued 1.5 s after the daemon's return when it had been down 15 s.
  - An upload restarted 6 s after the daemon's return and its hash matched.
  - Once the daemon had been down about a minute, the next attempt came up to 30 s after its return, from the backoff.
- **File changed on the daemon while a save waits:** `Download failed: The file changed on the daemon.`, `lastError {code: "changed"}`, no temp file.
- **Refused password:** `unauthorized` 41 ms after the dialog, with no temp file and no retry. A daemon restarted with another password while a save waited also failed it, 918 ms later.
- **Switch and close:**
  - Both ask with the native confirm "1 file transfer is still running. Switch anyway?".
  - Cancel kept the transfer running, and OK cancelled it.
  - OK on a window close ended the app and left no temp file.
- **Relay entry, dropped file, `--transfers page`:**
  - A relay entry reached the file input with no native window, and the upload and download worked.
  - A dropped file took the page's path. The engine counters and log did not move.
  - With `--transfers page`, `upload_pick` and `transfer_cancel` answer "File transfers use the page's own path in this launch.", and `ui.inspect` shows `mode: "page"`.
  - I could not drag a file from a real file manager, so the drop was a `drop` event dispatched with a `File`.
- **`ui.inspect` and log:**
  - `transfers` showed `bytesDone`, `bytesTotal`, `restarts` and `lastError {code, atMs}`, with no path or handle.
  - At the point I counted, there were 26 start lines, 16 end lines and 9 failure lines. Each carries the id, the daemon path and the local path.
  - The password, the control token and the pairing `offer=` appeared 0 times in the debug log.
- **Pending command:** a `transfer_save` stayed unanswered for 631 s with the daemon stopped. The save then finished 17 s after the daemon returned, with `Downloaded dl1.bin` and an equal hash.
- **Browser client (Chromium):**
  - Saves showed a percentage and Cancel, and uploads had Cancel.
  - A cancelled upload, an upload cut mid-way, and one over an existing file left nothing on the daemon and kept the old content.
- **Also seen:** a handle Rust did not issue, a local path as the handle, and `localPath` as an argument are all refused. A daemon missing `fileDownloadRanges` fails with `unsupported_daemon` in 42 ms.
- **Not live:** the daemon-disk-slowed test double (R4, covered by sprint-118 tests), and the 5 GiB check (sprint 123).

## Findings, not defects
- **Stale temp file:** a `kill -9`ed daemon leaves a 25.6 MB `.pistudio-upload-<hex>.part` for good, and the explorer lists it, greyed. The decision on hiding or removing it is still open in the spec.
- **No `appVersion` on the page:** the page's `hello` carries none, because the workbench never sets the SDK's `appVersion`, so `daemon_status` shows the two connections differently.
- **Cosmetic log wording:** a cancel is logged as `failed with cancelled`.
- **Native overwrite confirm:** the explorer's "Overwrite this file?" is a native confirm in the desktop app, so an upload of a listed name blocks every later dialog until someone answers it. The explorer's listing also doesn't refresh when a file is removed behind its back.

## Documents
- **`desktop/docs/development.md`:** new section "The transfer engine in the real webview" with the recipe, the traps and 15 numbered results.
- **`desktop/AGENTS.md`:** the "where it stands" paragraph now covers milestone 3 and the known gaps.
- **`desktop/README.md`:** the transfer paragraph is updated.
- **`desktop/docs/architecture.md`:** the "Which host the window uses" decision row was outdated and is rewritten, and 3 decision rows are added (where uploads and saves run, dialogs, dropped connections). The command table already had the four commands.
- **Spec `swe/features/desktop-transfer-engine.md`:** I answered the TODO(verify) items on the temp file, the 10-minute pending command, the native dialog, the picker and the page's memory, `appVersion`, the saved file's time, and the S3 counters.
  - Ticked: native dialog, `appVersion`, saved file's time.
  - Left open with notes: S3 counters, the temp-file decision, hours-long pending command, 5 GiB picker/memory.
  - Not touched: `minDaemonVersion`, the macOS runner scripts and stderr.
- **Not touched:** I left the Acceptance checkboxes and the status lines alone, and did not add the Milestone 3 section to `platform-checks.md` that the spec asks for.

## Wave gate (orchestrator, combined tree)
```
cargo xtask ci -> 8/8; npm run build/typecheck/lint -> ok; npm test -> 296 files, 4211 tests passed (task agent)
```
