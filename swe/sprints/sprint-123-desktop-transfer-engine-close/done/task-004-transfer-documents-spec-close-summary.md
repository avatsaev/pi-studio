## Task 004 (S123 T4) — Documents and spec close for milestone 3; `minDaemonVersion` — Summary

- **Completed:** 2026-11-22
- **Status:** done. Both gates pass. No lint errors, but the output ended on warnings I did not touch.

## What was implemented
- **`minDaemonVersion` is 0.0.126.** That is the next patch after `packages/protocol` 0.0.125.
  - `cli_answers::MIN_CLI_VERSION` is the one constant behind `min_daemon_version()`. It is also the oldest CLI the supervisor accepts, so a 0.0.125 CLI is now `cli_outdated`.
  - Tests moved with it: the `versions` test in `cli_answers.rs`, `the_minimum_daemon_version_is_the_clis` in `daemons.rs`, and the boot assertions in `page.rs` and `commands/tests.rs`.
  - The supervisor tests and `fake-pi-studio.sh` now use a fake CLI of 0.0.130, so they still count as "up to date".
  - The spec's TODO(verify) item is rewritten as a dated note, 2026-11-22. It says to re-check the number against the published version before the app ships.
- **The spec** (`swe/features/desktop-transfer-engine.md`) now has a final status line: built and checked on Linux 2026-11-22, one criterion open for the owner.
  - The runner-scripts and standard-error TODO items are carried, each with its reason.
  - macOS and Windows are recorded as removed by the owner.
- **The handoff** (`docs/desktop-client-handoff.md`):
  - A new status-table row.
  - Milestone 3's state: what was built, the measured numbers, the open items, and what milestone 4 can reuse.
  - The milestone 4 note: `Connector::connect` is where a relay or SSH stream plugs in. It returns the concrete `net::Socket`, so the stream has to be wrapped as one or the return type widened to `Transport`, which `Connection::open` already takes.
  - A new open-questions entry.
- **`swe/MAIN-SCOPE.md`:** the index row and the TODO item for milestone 3.
- **Root `AGENTS.md`:** the desktop paragraph and the protocol overview (temp file and rename, plus the 1 MiB / 256 KiB pacing).
- **`desktop/AGENTS.md`:** the `minDaemonVersion` note.
- **Other docs:** I fixed the stale `0.0.119` mentions in `desktop/docs/architecture.md` and `swe/features/desktop-daemon-registry.md`, and the "not built" lines in `swe/architecture/workbench-host-adapter.md`.
- **No change to `desktop/README.md`:** T1 and T2 already made it truthful.

## Files changed
- Code and tests: `desktop/crates/shell/src/cli_answers.rs`, `daemons.rs`, `page.rs`, `supervisor/tests.rs`, `desktop/crates/shell/tests/fixtures/fake-pi-studio.sh`, `desktop/apps/pistudiodesktop/src-tauri/src/commands/tests.rs`, and a comment in `scripts/platform-checks/macos.mjs`.
- Docs: `swe/features/desktop-transfer-engine.md`, `docs/desktop-client-handoff.md`, `swe/MAIN-SCOPE.md`, `AGENTS.md`, `desktop/AGENTS.md`, `desktop/docs/architecture.md`, `swe/features/desktop-daemon-registry.md`, `swe/architecture/workbench-host-adapter.md`.
- I did not touch `swe/sprints/`, so `PLAN.md` is still the orchestrator's to update.

## Build & test results
```
cargo xtask ci (desktop/)  -> all 8 steps passed (fmt, web, clippy, layers, test, panic_hunt, doctest, wasm)
npm run typecheck          -> ok
npm run lint               -> exit 0; warnings only (no-underscore-dangle, in packages/client)
npm test                   -> 296 files, 4211 tests passed
```

## Acceptance criteria
- [x] No document says "not built" about something built. I grepped the desktop docs, the handoff, MAIN-SCOPE, the specs and the architecture doc. The remaining "not built" lines are about the SSH gateway, the single-binary daemon and the transport bridge's failed-gate branch, none of which are built.
- [x] `min_daemon_version` is set to 0.0.126, with its tests and a dated note in the spec.
- [x] `cargo xtask ci` and the root gates pass.

## Follow-ups / open items for the owner
1. **Daemon growth mark missed.** The daemon grew 94 MiB against the 64 MiB mark on a fresh daemon's first 5 GiB upload (91–94 MiB in three fresh-daemon runs). The page's path grew it 74 MiB on its first upload too. The cause was not investigated. The checkbox stays open in the spec and the mark is unchanged: does the mark stand?
2. **`minDaemonVersion` 0.0.126 is a prediction.** It must be re-checked against the published version after the merge. If the merge publishes another number, change the constant and its tests.
3. **Temp file in the explorer.** Decide whether the explorer hides `.pistudio-upload-<hex>.part` and whether the daemon removes old ones at start. A `kill -9`ed daemon leaves one.
4. **Hours-long pending command.** Only 631 s was tried. A sleep during a transfer was not run.
5. **macOS and Windows are not checked** (owner's decision). That includes the native open dialog and the runner scripts.
6. **Standard error from a desktop launch.** Where it goes is unanswered.
7. **File drag.** A file dragged from the OS file manager was not tried; the drop was dispatched as an event.
8. **Handoff stale text.** The handoff's long milestone 1 row still lists "the Upload picker" as unverified on Linux; the new row 27 supersedes it. I did not rewrite that 6 KB line.
9. **Edit method.** I made the string replacements in `swe/features/desktop-daemon-registry.md` and `desktop/docs/architecture.md` with a Python script, not the `edit` tool. Content is checked by the doc diffs and the passing gates.

## Wave gate (orchestrator, combined tree)
```
cargo xtask ci -> 8/8; npm run typecheck/lint -> ok; npm test -> 296 files, 4211 tests passed (task agent)
```
