# Task 002 — Benchmark application: scaffold, local WebSocket server, baseline workloads — Summary

- **Sprint:** sprints/sprint-112-desktop-ipc-benchmark
- **Completed:** 2026-11-21
- **Status:** done

## What was implemented
New workspace member `desktop/apps/ipc-bench` (`pistudiodesktop-ipc-bench`): a small Tauri app with its own config, capability and static page (plain ES modules, no npm package, `package-lock.json` unchanged). A loopback WebSocket server (`/echo`, `/flood`, `/sink`, `TCP_NODELAY`), workloads B1-B5 over the page's own `WebSocket` behind a small transport interface (`TRANSPORTS` is where task-004 adds candidates), B6 on every workload (counter, checksum, running hash), options `--out --runs --only --scale --corrupt --swap --timeout`, and `results.json` (schema 1). Four commands: `bench_config`, `bench_rss`, `bench_progress`, `bench_finish`. B4 memory comes from the app's process tree (`/proc`, `ps`, PowerShell).

## Files
`desktop/apps/ipc-bench/**` (Cargo.toml, build.rs, tauri.conf.json, capabilities, src: main, commands, frame, server, procs; page: index.html, main.js, workloads.js, transport.js, stats.js, frame.js, frame.test.mjs); `desktop/Cargo.toml` (member + `tokio`, `tokio-tungstenite`, `futures-util`), `desktop/xtask/src/layers.rs` (exempt), `desktop/docs/development.md` (new section), `desktop/AGENTS.md`, `desktop/README.md`, `desktop/docs/architecture.md`, `desktop/.gitignore`, `Cargo.lock`. `apps/pistudiodesktop` and `desktop-release.yml` unchanged. Licences: all MIT or MIT OR Apache-2.0.

## Results
```
cargo test -p pistudiodesktop-ipc-bench      25 passed;  node --test page/frame.test.mjs   5 passed
container (pi-desktop-xvfb, release, WebKitGTK):  --scale 0.1 exit 0;  full scale exit 0 in 14.6 s
  baseline worst of 3: B2 4 KiB 528 MiB/s, B2 64 KiB 2000 MiB/s, B3 794k frames/s,
                       B4 1660 MiB/s (memory growth 376 MiB), B5 85.6 MiB/s (bufferedAmount 0 at the end)
--corrupt 7 (b1,b2,b3,b5): exit 1, names workload and frame;  --swap 5 (b2,b3,b5): exit 1, names frames 5 and 6
--timeout 3: exit 1
```

## Wave gate (orchestrator, combined tree, 2026-11-21)
```
$ (cd desktop && cargo xtask ci)     all 8 steps passed (fmt, web, clippy, layers, test, panic_hunt, doctest, wasm)
$ npm run build && npm run typecheck && npm run lint && npm test
  build 0, typecheck 0, lint 0 (warnings only in files this work did not touch), 291 files, 4132 tests passed
```

## Acceptance criteria
All five met. `--swap` does not apply to B1 (a one-at-a-time echo cannot reorder).

## Follow-ups / TODO(verify)
- WebKit's `performance.now()` steps by 1 ms: B1's median and p99 read 0 or 1 at 30-45 us per trip; the mean decides (spec B1 row amended). A finer timer via cross-origin isolation was tried and did not work.
- The baseline B5 is capped near 100 MiB/s by the SDK's 10 ms pacing poll.
- B2 needs a 256 KiB size (added to task-004).
- macOS `ps` and Windows PowerShell memory paths are tested on sample output only; Linux ran live.
