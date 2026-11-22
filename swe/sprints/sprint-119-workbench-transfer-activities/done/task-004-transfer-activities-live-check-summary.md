# Task 004 — Live check of the activity lines in the web client, and the documents — Summary

- **Sprint:** sprints/sprint-119-workbench-transfer-activities
- **Completed:** 2026-11-22
- **Status:** done (run by the orchestrator)

## What was done
The built web client (`pi-studio ui` on 127.0.0.1:17680) in headless Chromium, against an isolated production daemon (`/tmp/pi-live-118/home`, 127.0.0.1:17621) that carries sprint 118 and had its file writes delayed 1 ms so that a line stays visible. Workspace `/tmp/pi-live-118/work`.

| Run | Seen |
|---|---|
| Batch of three 100 MiB files from the Upload button | One line, `Uploading 3 files… 0%` rising through 69 distinct texts to `100%`, then `Uploaded 3 files`; all three files on the daemon |
| The same batch, Cancel (`Cancel: Uploading 3 files`) at 45% (during the second file) | `Upload cancelled`; the first file is on the daemon, the second left nothing (no temporary file), the third never started |
| Two 300 MiB saves from the row menu, started together | Two lines (`Downloading big-a.bin… 38%`, `Downloading big-b.bin… 3%`), each with its own Cancel; the second cancelled -> `Download cancelled`, the first continued to `Downloaded big-a.bin` |
| Save of an unreadable file from the row menu | `Download failed: unreadable`, drawn with the error style |
| Save from a viewer's Download button (300 MiB file, "too large to display"), cancelled from its line | The line appeared in the explorer; after Cancel `Download cancelled`, and the viewer showed no error |

Images of the dark theme were taken during the runs (batch at 3%, two saves, cancelled, failed). The web client has no theme switch in Settings, so no light-theme image was taken.

## Files changed
| File | Change |
|---|---|
| `swe/features/file-explorer-transfer.md` | The activity lines described as built |

`packages/workbench/AGENTS.md` already carries the entries (store, text functions, `ActivityLines`, the registering paths) from tasks 002 and 003.

## Acceptance criteria
- [x] Every run is done and reported; a cancelled upload left nothing on the daemon (sprint 118 is built on the branch).
- [x] Root gates pass (below).
- [x] Images for the owner: the web client's explorer during a batch, with two saves, after a cancel, after a failure. The owner looks at the web client before a merge.

## Follow-ups / TODO(verify)
- "A line's DOM changes only when its text does" rests on `React.memo`; not measured.
- Light theme not looked at.
- A row-menu alert after a cancel could not be observed either way in headless Chromium (alerts are accepted automatically); the code path branches on `isAbortError`.


## Wave gate (orchestrator, combined tree)
```
npm run build -> ok; npm run typecheck -> ok; npm run lint -> 0 errors; npm test -> 296 files, 4211 tests passed
desktop frontend: npm run snapshot -> wrote snapshot.png, no CSP violation
```
