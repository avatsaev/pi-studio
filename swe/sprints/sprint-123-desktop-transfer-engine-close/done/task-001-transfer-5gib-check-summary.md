# Task 001 — The 5 GiB check, the Linux acceptance run, and the checklist's milestone 3 section — Summary

- **Sprint:** sprints/sprint-123-desktop-transfer-engine-close
- **Completed:** 2026-11-22
- **Status:** done, with one miss reported to the owner

## What was implemented
I ran the D16 check on Linux over loopback in the real WebKitGTK webview (`pi-desktop-xvfb`, scratch on `/home`, since `/tmp` is a tmpfs the size of RAM). The app was a release build of `c4e8032`, the production daemon ran on the host, and the native Open and Save dialogs were driven with `xdotool`.

- **Marks run:** each of the 5 GiB upload and the 5 GiB save was run 3 times, then the same on `--transfers page` on the same binary.
- **Measured per run:** SHA-256 of both copies, `peakHeld`, the growth of the app, `WebKitWebProces`, `WebKitNetworkPr` and the daemon (`VmRSS` every 250 ms), the rate, and key echo (a key every ~63 ms, timed on the page's clock).
- **Extra runs:** a clean-HEAD release build (1 upload, 1 save), a typing-only 64 s run for the web process's baseline growth, and a 64 s upload throttled to 80 MiB/s.
- **S3 counts:** the app has no counters for the liveness limit or the 1 MiB hold. I added throwaway ones in `crates/transfer/src/connection/reader.rs`, used them for the S3 numbers, then reverted them. `desktop/` shows no diff against HEAD.

## Files created / changed
| File | Change |
|---|---|
| `desktop/docs/platform-checks.md` | New "Milestone 3: file transfers in Rust": T1–T8 (scripted or manual, steps and expected result), the results table, S3 counts, a results row per machine. Linux is filled in. macOS and Windows say "not checked, owner's decision 2026-11-22". T7 and T8 (a sleep) are manual and not run. |
| `desktop/docs/development.md` | New "The 5 GiB check" recipe and traps; one sentence in the previous section updated |
| `desktop/AGENTS.md` | "Where it stands" now has the 5 GiB result instead of "sprint 123's" |
| `swe/features/desktop-transfer-engine.md` | Criteria ticked or annotated with numbers or their source; S3 and picker/memory TODO(verify) items answered |

## Results against the marks

| Mark (D16) | Upload (3 runs) | Save (3 runs) | Verdict |
|---|---|---|---|
| SHA-256 equal | 6 of 6 | 5 of 5 | pass |
| `peakHeld` < 64 MiB | 32 768 B | 1 048 640 B | pass |
| App Rust process ≤ 64 MiB | 11.9 / 1.3 / 0.9 | 4.7 / 1.0 / 0.8 | pass |
| Web process ≤ 32 MiB | 4.1 / 5.3 / 4.5 | 7.0 / 25.3 / 0 | pass |
| Daemon ≤ 64 MiB | **94.0** / 44.8 / 33.5 (clean build 94.4, earlier run 91.3) | 34.3 / 31.2 / 3.4 | **miss for the first upload into a fresh daemon** |
| Not slower than `--transfers page` | 503 / 489 / 489 MiB/s vs 158 / 157 / 158 (3.1×) | 1139 / 927 / 1085 vs 160 / 162 / 162 (5.7–7.1×) | pass |
| Echo ≤ +5 ms median, ≤ +50 ms p99 | median 5 ms, p99 9 / 8 / 9 | median 4 ms, p99 9 / 6 / 7 | pass |

- **No transfer:** key echo is median 5 ms, p99 6 ms.
- **64 s throttled upload:** p99 was 44 ms against 7 ms in that run's own baseline, which is +37 ms and inside the 50 ms mark.
- **Daemon miss:** the daemon's growth is Node anonymous memory. It rose from 167 MiB to a plateau of 285 MiB over six transfers.
- **Page path:** it also grew the daemon 74.2 MiB on its first upload, so the cause is the first large write into a fresh daemon. I did not look into it further.
- **Page path completed 5 GiB both ways.** Its upload grew the web process by 7.7, 5.7 and 7.1 GiB.
- **Web process drift:** typing alone grew it 42.7 MiB in 64 s, so its growth during a transfer includes that.

**S3 counts:**
- **Liveness limit (30 s):** never reached, 0 drops.
- **10 s ping:** 10 sent in the six transfers' run.
  - 3 were during uploads, one in each 10.2–10.5 s upload. The daemon sends nothing back until an upload completes.
  - 7 were on the idle open connection.
  - None came during a save.
  - The 64 s upload sent 6, and each was answered.
- **1 MiB hold:** reached in every save (`peakHeld` 1 048 640 B). The frames that waited were 2154, 5603 and 940 of 163 842, which is 1.3 %, 3.4 % and 0.6 %. An upload has no hold.

## Build & test results
```
$ cargo xtask ci   (in desktop/)
CI summary: all 8 steps passed (fmt, web, clippy, layers, test, panic_hunt, doctest, wasm)

$ npm run build && npm run typecheck && npm run lint && npm test   (root)
build and typecheck ok; lint exit 0 (warnings only, in files I did not touch)
Test Files 296 passed (296) | Tests 4211 passed (4211)
```
Both gates ran on the tree after I reverted the instrumentation. I made only doc edits after that.

## Acceptance criteria
- [~] The four criteria of "The check" are reported with numbers. Three pass, and the upload criterion misses on the daemon's growth (94 vs 64 MiB). I left its checkbox open in the spec and did not change the mark.
- [x] Every other spec criterion is ticked from sprint 122's task-007 run, the Rust tests, the sprint-118 daemon test or this run, each with its source in the spec.
- [x] `cargo xtask ci` and the root gates pass.

## Follow-ups / TODO(verify)
- **Owner decision:** whether the 64 MiB daemon mark stands (a fresh daemon grew 91–94 MiB on its first 5 GiB upload).
- **Spec checkboxes:** every box except the upload criterion is ticked. The spec's status lines are untouched.
- **`docs/desktop-client-handoff.md` is stale.** Its milestone 3 paragraph still says "nothing built". I did not touch it.
- **Not run, and no tool could run them:** a real machine sleep (T7, T8), macOS and Windows.
- **Cleanup:** I removed the container, the proxy, the daemon and the 15 GiB scratch directory, and nothing is left running.
- **Unrelated daemon kill:** early on I ran `pkill -f dist/daemon/main.js`, which would have matched any daemon on the machine. Afterwards no other daemon was running, so I can't say whether I killed one. I used PID-exact kills after that.

## Wave gate (orchestrator, combined tree)
```
cargo xtask ci -> 8/8; npm run build/typecheck/lint -> ok; npm test -> 296 files, 4211 tests passed (task agent)
```
