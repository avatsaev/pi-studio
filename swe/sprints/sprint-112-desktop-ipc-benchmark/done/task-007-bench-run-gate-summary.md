# Task 007 — Run the benchmark on three platforms, write the note, state the gate — Summary

- **Sprint:** sprints/sprint-112-desktop-ipc-benchmark
- **Completed:** 2026-11-22
- **Status:** done

## Result
**The gate failed.** No variant of the channel bridge passes every gated row on all three platforms. Sprints 115 and 116 are blocked; the design choice is task-008, which waits for the owner.

## What was done
- With the owner's word (2026-11-21) the branch was pushed and draft pull request 60 opened ("do not merge"). The workflow ran five times on the macOS and Windows runners; the benchmark was fixed between runs (a late acknowledgement after close, a message-count window, a stall watchdog, a lost-message report) and gained a fourth transport, `proxy-ws`. Details of each fix: task-004's summary, addenda 1 and 2.
- `swe/notes/desktop-ipc-benchmark.md` § Results on three platforms: the verdict, the five runs with their links, machines and versions, every row for Windows and macOS (run 5: the worst of three with the three values), the Linux figures, the gated rows for the two designs still standing, the agreement between runs 3, 4 and 5, why the channel is slow on Windows, the three channel failures, the hidden window and P7, the proxy's costs, and a proposal to the owner.
- `swe/features/desktop-transport-bridge.md`: the status line, § 1 "Result", the two Benchmark criteria ticked, the IPC-path TODO answered.
- `swe/sprints/PLAN.md`, `docs/desktop-client-handoff.md`: agree with the failure.
- The nine tasks of sprints 115 and 116 moved to `blocked/` with a Blocker naming the rows; task-008 added.

## Results (run 5, worst of three; the note has everything)
| Row | Mark | Windows: baseline / batched channel / proxy | macOS: baseline / batched channel / proxy |
|---|---|---|---|
| B2 4 KiB, MiB/s | at least 40 | 104.8 / 33.5 FAIL / 90.7 | 48.9 / 159.9 / 52.4 |
| B2 64 KiB, MiB/s | at least 40 | 55.3 / 34.7 FAIL / 175.8 | 587.2 / 127.6 / 460.4 |
| B3, frames/s | at least 5,000 | 36,087 / 86,419 / 38,369 | 16,027 / 375,234 / 12,561 |
| B4, MiB/s | half the baseline | 177.5 / 29.9 FAIL / 164.1 | 359.4 / 155.9 FAIL / 292.9 |
| B5, MiB/s | half the baseline | 84.7 / 28.6 FAIL / 83.6 | 74.9 / 80.9 / 67.9 |
| B1, median slower by | at most 1 ms | n/a / 1.2 ms FAIL / 0.1 ms | (mean) n/a / 0.65 / 0.03 |
| B7 echo mean during a download | reported | 5.9 / 199.4 / 7.3 ms | 2.4 / 51.5 / 4.8 ms |

Linux (worst of three): batched channel B4 503.9 MiB/s against a mark of 1,009.9 (fails only the half-the-baseline rule) and B4 memory growth 162 MiB against 72 (the baseline grew 194); every other row passes. Proxy: within about 10 % of the baseline; fails only B4 memory growth (246 MiB; baseline 198).

Runs: https://github.com/avatsaev/pi-studio/actions/runs/44916778278 (1), /44917963549 (2), /44921715444 (3), /44925277721 (4), /44928495924 (5).

## Acceptance criteria
- [x] The note has all three platforms with every row and the versions. **With one gap:** the Linux `results.json` files were kept only in `/tmp` and were lost on 2026-11-22, so Linux shows the worst-of-three values copied from the runs' output and not the three per-run values, and no Linux file is attached. The WebKitGTK version was not recorded.
- [x] The gate is stated as failed, and the spec, `PLAN.md` and the handoff agree.
- [x] The tasks of sprints 115 and 116 are in `blocked/` and the design task exists (task-008).

## Decisions and proposals for the owner
- No pass mark was changed. Proposed: the B4 memory mark becomes "no more than the baseline in the same run, plus 64 MiB" (the baseline misses the written one on Linux and Windows).
- Proposed design: the loopback proxy on all three platforms. Alternatives and costs are in the note.
- P7 stands: on macOS a hidden page's timer fired 0.5 to 1 s late and a worker's at most 20 ms late.

## Follow-ups / TODO(verify)
- Linux: rerun once and attach `results.json` (the owner asked for no new benchmark runs on 2026-11-22).
- No real machine was measured; the runners have 3 and 4 logical cores.
- The cause of the lost channel message on macOS (run 3) is unproven; it did not recur.
- A streamed custom-scheme response (the spec's other candidate) was not measured.
- Windows B8 says nothing: the webview never reported the window hidden.
- The per-message cost on Windows (about 1.15 ms per fetched message) is inferred from rates and source, not profiled.
- The pull request is a draft and must not be merged as it is: the branch changes `packages/workbench`, so a merge publishes an npm release.
