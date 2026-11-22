# Task 003 — Live check of the daemon's upload changes with the browser client and the SDK — Summary

- **Sprint:** sprints/sprint-118-upload-atomic-paced
- **Completed:** 2026-11-22
- **Status:** done (run by the orchestrator)

## What was done
An isolated production daemon (`PI_STUDIO_HOME=/tmp/pi-live-118/home`, `127.0.0.1:17621`, its own Pi home, extension sync off) was driven by a throwaway SDK script, by the built web client in headless Chromium, and through a local relay. No code changed. `~/.pi-studio` and port 6767 were not touched.

Two preload modules (throwaway, outside the repository) counted `WebSocket.pause()` calls in the daemon and, for the slow-disk runs, delayed every file write by 1 ms.

## Results
| Run | Result |
|---|---|
| SDK, 600 MiB onto tmpfs | 86 MiB/s, SHA-256 equal, daemon RSS 59 MiB before / peak / after, reading stopped 3 times, same-connection `ping` median 1 ms, max 3 ms |
| SDK, 600 MiB, writes delayed 1 ms | 28 MiB/s, SHA-256 equal, RSS 59 -> 60 -> 59 MiB, reading stopped 736 times, same-connection `ping` median 157 ms, max 244 ms |
| SDK, aborted near 200 MiB (new path) | `AbortError`; no file, no `.pistudio-upload-*.part` |
| SDK, client process killed near 200 MiB (new path) | no file, no temporary file |
| SDK, abort and kill onto an existing file | the file still held its old content; no temporary file |
| Web client (headless Chromium), 600 MiB, writes delayed 1 ms | 29 MiB/s, SHA-256 equal, daemon RSS 186 -> 221 -> 191 MiB, reading stopped 736 times; the explorer listed `.pistudio-upload-<hex>.part` during the upload and not after |
| Local relay, 200 MiB, writes delayed 1 ms (throwaway vitest file, deleted) | 21 MiB/s, reading stopped 364 times; uploader's own `ping` median 523 ms; a second client's `ping` median 0.25 ms (idle 0.24 ms), max 120 ms |

## Files changed
| File | Change |
|---|---|
| `docs/desktop-client-handoff.md` | § 2: upload pacing and the measurements |
| `swe/features/desktop-transfer-engine.md` | § TODO(verify): the R4 item answered, the R3 item narrowed |

## Acceptance criteria
- [x] Every run is done and reported with its numbers; no run touched `~/.pi-studio` or port 6767.
- [x] The spec's R4 TODO(verify) item is answered; the R3 item is narrowed (the file is visible in the explorer; hiding it and sweeping old ones stay undecided).
- [x] Root gates pass (below).

## Follow-ups / TODO(verify)
- A real slow disk was not available: the delay was injected into the daemon's file writes. The real `ws` socket, the real TCP connection and the real relay were used.
- One run by mistake uploaded to a path relative to the daemon's working directory (the repository): `work/full.bin` was created there and removed. Upload paths are used as given, without `~` expansion or a base directory.
- Decide whether the explorer hides `.pistudio-upload-*.part` and whether the daemon removes old ones at start.


## Wave gate (orchestrator, combined tree)
```
npm run build -> ok; npm run typecheck -> ok; npm run lint -> 0 errors; npm test -> 296 files, 4211 tests passed
desktop frontend: npm run snapshot -> wrote snapshot.png, no CSP violation
```
