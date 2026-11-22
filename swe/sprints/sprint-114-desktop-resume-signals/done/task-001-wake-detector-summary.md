# Task 001 — Wake detection and the `connection_resume` event — Summary

- **Sprint:** sprints/sprint-114-desktop-resume-signals
- **Completed:** 2026-11-21
- **Status:** done

## What was implemented
- `crates/shell/src/resume.rs` (new, pure, no `log::`, no clock read, wasm-safe): `WakeDetector::observe(wall_ms, steady_ms)`; a tick is a wake when `max(wall elapsed, steady elapsed) - 2 s >= 10 s`. A backward wall clock (or steady clock) is not a wake, only a new baseline; the arithmetic saturates. `ResumeSignals` holds one rate limit for all reasons (at most one signal per 5 s from the last one let through) and the counts; `signal(reason, now_ms)` says whether to emit and only emitted signals are counted; `counts()` is `{wake, network}`. `Reason` is `Wake | Network`.
- Shell wiring: `AppShell.resume: Arc<ResumeSignals>`; `control::view` reports `connection: { secretStore, resumeSignals: { wake, network } }` (it extends the object of task 113/t006).
- App binary `src-tauri/src/resume.rs` (new): a thread `resume-ticker` waits on `recv_timeout(2 s)`, reads the clocks, runs the detector and emits `connection_resume {reason:"wake"}` through `emit()` (which applies the rate limit first). `steady_ms()` is one shared clock (`LazyLock<Instant>`) for the later network watcher. `Ticker` is managed Tauri state, stopped on `RunEvent::Exit` and on drop. No `unwrap`, no `unsafe`; an emit or spawn failure is logged. `main.rs` creates the `ResumeSignals` and passes it through `bridge::Launch.resume`.
- Docs: `control-protocol.md` (`ui.inspect` row), `architecture.md` (seam 5, events, a Resume signals paragraph, a Threads bullet), `desktop/AGENTS.md`, doc comments.
- Files: new `crates/shell/src/resume.rs`, `apps/pistudiodesktop/src-tauri/src/resume.rs`; changed shell `lib.rs`, `control.rs`, `tests.rs`, `tests/secret_guard.rs`; app `bridge.rs`, `main.rs`, `commands.rs`, `commands/tests.rs`. No new dependency.

## Results
```
cargo test -p pistudiodesktop-shell -p pistudiodesktop   app 48, shell 166 (+ secret_guard 1), 7 new resume tests in the app
live (pi-desktop-xvfb, private copy of the debug binary, --secret-store file, scratch --config-dir): before: resumeSignals {wake 0, network 0};
  kill -STOP for 15 s then kill -CONT: wake 1 about 5 s later; a second 3 s stop left it at 1; the log shows "resume signal: wake"
```

## Wave gate (orchestrator, combined tree, 2026-11-21)
```
$ (cd desktop && cargo xtask ci)     all 8 steps passed (fmt, web, clippy, layers, test, panic_hunt, doctest, wasm)
$ (cd desktop/apps/pistudiodesktop && npm run check && npm run lint && npm test)     exit 0; 120 tests passed
```
(No file under `packages/` changed in this wave; the root gates of wave 4 stand.)

## Acceptance criteria
Met: injected-clock cases (10 s signals once, 9 s does not, a backward wall clock does not, two gaps within 5 s give one, shared across reasons); the container run (wake +1); the ticker stops on exit and never panics (tests: a stop heard at once, a dropped sender, a mock-app start and stop; a real app exit was not observed beyond the process ending).

## Follow-ups / TODO(verify)
- The page receiving the event and reconnecting was not shown (no page listener in the run): task-004.
- Design choice: both clocks are compared, so a stopped process (both advance) and a system sleep (only the wall clock moves) are both detected (spec section 6 amended).
- Task-002 reuses `resume::emit(handle, &signals, Reason::Network, resume::steady_ms())` and the same `Arc<ResumeSignals>` (from `Launch.resume`).
