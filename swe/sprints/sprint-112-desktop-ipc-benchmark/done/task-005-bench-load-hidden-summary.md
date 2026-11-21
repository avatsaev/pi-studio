# Task 005 — Benchmark: echo under load, a hidden window, worker timers (B7, B8) and memory — Summary

- **Sprint:** sprints/sprint-112-desktop-ipc-benchmark
- **Completed:** 2026-11-21
- **Status:** done

## What was implemented
Rows B7 and B8 on all three transports (`--only b7,b8`), and B4's memory samples in the results.
- Server (`src/server.rs`): routes `/mixed?frames&size` (a binary flood that also echoes, on one socket) and `/paced?rate&seconds&size` (1,000 frames/s in 10 ms ticks, a late tick makes up what is due); `--corrupt` and `--swap` apply to both.
- B7 (`page/load.js`): B1's echo while B4's 1 GiB download runs; mean, median, p90, p99, max, the 20 slowest, and the download rate; both integrity-checked.
- B8 (`page/load.js`, `page/hidden.js`, `page/worker-timers.js`): 30 s hidden plus 2 s of stream, as `B8/hide` and `B8/minimise`. Rust does the whole hide-hold-show (`bench_window_hold`). Recorded: frames lost, most bytes Rust held, catch-up time, frames delivered while hidden, the window state the system reported, `visibilitychange` events. A 500 ms worker-timer chain built from the same worker source as `packages/workbench/src/host/browser-worker-timers.ts` (a node test fails if the two drift) beside a page `setTimeout` chain; a 2 s Rust tick (`src/tick.rs`, `bench_tick_start`, `bench_tick_stop`) records its largest gap. A lost frame, or held bytes above the window plus a frame, fails the run and names what was lost.
- `page/compare.js`: B7 reported against the baseline with no pass mark; B8 passes or fails on frames lost and held bytes and reports the timers and tick.
- The bench's `tauri.conf.json` has `worker-src 'self' blob:` as the app does. Docs: `desktop/docs/development.md` (B7 and B8, routes, `--only`, the Xvfb caveat and how to get a window manager into the container), `desktop/AGENTS.md`, `desktop/README.md`. No new dependency.

## Results
```
cargo test -p pistudiodesktop-ipc-bench   44 passed;  node --test page/*.test.mjs   41 passed;  clippy clean
container, full scale, 3 runs, release, WebKitGTK, a window manager (openbox) over Xvfb: exit 0, every run ok, about 10 minutes
--only b7,b8 --scale 0.1 --runs 1 with --corrupt 7 and with --swap 5: exit 1, naming transport, workload, frame and stream
```
Under plain Xvfb `minimize()` does nothing, so the full run used a local image derived from `pi-desktop-xvfb` with openbox (recipe in `development.md`; the image was deleted). Results: `/tmp/ipc-bench-results/results.json` (not committed).

B8, 6 runs per transport and mode, Linux:

| Transport | Frames lost | Most bytes Rust held | Catch up | Worker timer worst delay | Page timer worst delay | Rust 2 s tick worst delay |
|---|---|---|---|---|---|---|
| websocket | 0 | n/a | 0 ms | 1.0 ms | 500-501 ms | at most 2.0 ms |
| bridge-frame | 0 | 245,760 | 0 ms | 1.0 ms | 500-501 ms | at most 2.0 ms |
| bridge-batch | 0 | 245,760-245,826 | 0 ms | 1.0 ms | 956-977 ms | at most 1.9 ms |

The worker timer fired 59-60 of 60 times while hidden; the page timer only 33-35 (WebKitGTK throttles hidden `setTimeout` chains to about 1 s). About 30,000 frames were delivered while hidden: the page kept receiving.

B7, worst of 3 runs (p99 and mean round trip with the download running; trips per run 88-94 for the bridges, 141-163 for the baseline):

| Transport | p99 | Mean | Download rate |
|---|---|---|---|
| websocket | 17 ms | 3.4 ms | 2000 MiB/s |
| bridge-frame | 54 ms | 31.7 ms | 351 MiB/s |
| bridge-batch | 37 ms | 22.2 ms | 481 MiB/s |

B4 unchanged from task-004: the two bridges miss "half the baseline" (bridge-frame 340, bridge-batch 498 against 984.6 MiB/s) and the memory-growth bound (394,676 and 168,324 against 73,728 KiB; the baseline's own growth is 192,248). No pass mark was changed.

## Wave gate (orchestrator, combined tree, 2026-11-21)
```
$ (cd desktop && cargo xtask ci)     all 8 steps passed (fmt, web, clippy, layers, test, panic_hunt, doctest, wasm)
$ node --test desktop/apps/ipc-bench/page/*.test.mjs     41 passed
```
(No file under `packages/` or the app's TypeScript changed in this wave; the root gates of wave 2 stand.)

## Acceptance criteria
All four met.

## Follow-ups / TODO(verify)
- P7: Linux is a window manager over Xvfb, not a real desktop; macOS (WKWebView) and Windows (WebView2) are the evidence, and whether the 2 s tick runs while macOS naps a hidden app. The page ran normally while hidden, so the held-bytes bound and the "page falls behind" path were not stressed (W1 tests the bound).
- `bridge_window_hold` (hide, minimise, state read-back) has only run on Linux.
- `bridge-batch`'s page timer was about 1 s late; not investigated (looks like coalescing while the main thread is busy).
- B7's p99 comes from fewer than 200 trips (the download ends in 0.5-3 s).
