## Summary — Task 005: Hardening (milestone 3 transfer engine)

**Status:** All five deliverables are written and pass. `cargo xtask ci` passes all 8 steps (fmt, web, clippy, layers, test, panic_hunt, doctest, wasm).

### Tests added (`desktop/crates/transfer/src/engine/tests/`)
- **`stages.rs`** is a 24-row table: upload and save × 6 stages × drop/cancel. The stages are before the request, before its answer, before `Begin`, in the middle, after `End` before the confirmation, and while waiting to reconnect.
  - A coverage test fails if any row is missing.
  - Each row checks the transfer's states, that the daemon holds a whole file or none, that the sink is finished or discarded exactly once, `streams_in_use() == 0`, and that a later transfer still works.
- **`hostile.rs`** has 25 tests:
  - Every stand-in fault, run for both directions.
  - A raw hostile WebSocket server with 17 behaviors and 24 seeded storm rows.
  - Each ends the connection as `protocol`, or the transfer with its code.
  - `peak_held` stays within the limit, and a test-only panic hook asserts the library never panics.
- **`soak.rs`** is seeded (`0x5EED_2026_1122`): 60 rounds of 3 transfers at once with random faults and cancels, about 1 s.
  - Every transfer settles with a known code.
  - Completed transfers are byte-exact; failed saves are discarded once; a failed upload leaves no file or a whole one.
  - The daemon ends with no reserved streams or open connections.
  - Faults are exercised for real: one stats run showed 14 connections opened, 17 failures and 3 cancels.
- **`markers.rs`** plants a password, a wrong password, a local path, a 32-hex handle and a daemon path in the connector, daemon, source and sink (including their `Debug` and a source panic payload).
  - It runs about 15 scenarios: ok, failed and cancelled transfers, a queue, wrong password.
  - It searches every failure, event and snapshot, and found no marker.
  - Control tests prove the search finds a marker and that the scenarios were not vacuous.
- **`counters.rs`** has 3 tests:
  - A 5 GiB + 12 345 B upload through `CountingSource` into a stand-in that stores nothing.
  - A 5 GiB save into a counting sink.
  - A resume at offset 5 GiB + 7 straight through `download::save`.
  - They check exact results, progress above 4 GiB sampled and monotonic, and small `peak_held`.
  - Together they take about 1 s.
- **`rigs.rs`** holds the shared rigs: `RigSink`, `CountingSource`, and the panic hook. The scripted connector moved from `recovery.rs` to `support.rs`.

### Stand-in changes (`src/testing/`)
- New API: `put_counted_file`, `Config::store_uploads`, `streams_in_use()`, `resume_reading()`.
- New tests in `testing/tests/streams.rs`.
- **Defect found and fixed.** When a fault hangs up just as a download is answered, the stand-in never spawned the download task and leaked its stream. It is now freed when the connection drops, with a regression test. This was in the stand-in, not the engine; I found no defect in the engine itself.

### Verification
- `cargo test -p pistudiodesktop-transfer -q -- --test-threads=1` passed 20 times in a row: 366 tests, about 20.7 s each run.
- The soak also passed 5 times under `taskset -c 0`, at 1.07 s each.
- The counters tests passed under `taskset -c 0`.
- Clippy with `-D warnings` is clean with and without `--all-features`; `cargo fmt --all -- --check` is clean.
- I broke the code three ways to check the tests catch it, then restored each:
  - Skipping the discard on an unstarted cancel failed `stages.rs`.
  - Skipping the abort after an unanswered cancel failed `stages.rs`.
  - Dropping the over-announced-bytes check failed `hostile` (both the new and the existing one) and `soak`.

### Docs
Updated `desktop/AGENTS.md`, `desktop/README.md` and `desktop/docs/architecture.md` for the new stand-in API and the five hardening test modules.

### Follow-ups
- A cancelled upload whose answer arrives after `close_wait` leaves the daemon-side stream reserved until the connection ends. The `BeforeBegin` cancel row works around it by letting the answer arrive in time.
- A cancel after `End` leaves the upload on the daemon, and a cancel during a save's `finish` is ignored so the save completes. The stages table asserts both.
- The panic hook in `rigs.rs` is test-only, and the soak's fault order is seeded but the task interleaving is the scheduler's.

I did not touch `swe/sprints/` and ran no state-changing git commands. All changes are uncommitted.

## Wave gate (orchestrator, combined tree)
```
cargo xtask ci (desktop/) -> all 8 steps passed (task agent, single agent in the tree)
```
