# Task 002 — App: the registry at launch, in the boot snapshot, and reachable from the page — Summary

**Sprint:** sprint-109 · **Completed:** 2026-11-20 · **Status:** done (`cargo xtask ci` passes, all 8 steps)

## What was implemented

- **Launch.**
  - `spawn_owner` takes a new `Launch { notify, local_supported }`. It calls `set_local_supported(cfg!(not(windows)))` and queues a first `daemon.local.refresh`. The window does not wait for it.
  - The initial change flag is cleared, so the page's first view is the boot snapshot.
  - The native process hooks were already in `services::native`.
- **Background runner.** `daemons::start_runner` starts a thread that pumps the supervisor on each wake-up. It reaches the session through `OwnerAccess` (new, in `shell/owner_access.rs`), which sends short `LocalOp` requests to the owner thread. The CLI runs on the runner's thread, so storage, the control socket and dialogs keep working during a start.
- **Boot snapshot.** It gains `daemons: { currentId, entries, local, settings }` and `app.minDaemonVersion`. The version comes from `cli_answers::MIN_CLI_VERSION`, so `0.0.119` is defined in one place. `ui.inspect` now uses the same `daemons::view`.
- **Page commands** (in `build.rs`, `generate_handler!` and `capabilities/default.json`):
  - `engine_command { id, params? }` runs only the ten allowed ids. Anything else is refused with "the page may not run `<id>`", which includes `daemon.switch` and `command.list`.
  - `daemon_resolve_current` takes no id and runs on a blocking thread through the shared `Arc<Supervisor>`. It answers `{ url, password?, connect: true }` or a code.
- **Event `daemons_changed`.** `owner::serve_notifying` calls `Notify::changed(view)` after any request that changed the registry, the local state or a setting. `Notify::local_work` wakes the runner. The page's capability adds `core:event:allow-listen` and `allow-unlisten`.
- **Engine fixes.**
  - `Session::set_setting` now marks a change, so settings changes fire the event.
  - `Session::has_local_requests` is new.

## Files

- **`crates/shell`:**
  - new: `daemons.rs`, `owner_access.rs`
  - changed: `control.rs`, `lib.rs`, `owner.rs`, `page.rs`, `supervisor.rs`
- **`crates/engine`:** `session.rs`, `local.rs`.
- **`src-tauri`:**
  - new: `daemons.rs`
  - changed: `bridge.rs`, `commands.rs`, `main.rs`, `build.rs`, `capabilities/default.json`, `commands/tests.rs`

## Build & test results

- `cargo xtask ci` passes: fmt, web, clippy, layers, test, panic_hunt, doctest, wasm.
- New tests cover:
  - the allowed-id check and the view with no secret;
  - "who is told" (one event per change, none for reads);
  - one `daemon.add` giving one event with a fake emitter;
  - boot and `ui.inspect` holding the same view;
  - the resolve answer and its `unsupported` error;
  - `Batch` and `Dial` round-tripping through the owner channel;
  - a slow start (fake CLI, 0.4 s) leaving `storage_set` and `settings.get` answered in under 250 ms;
  - the capability list.

## Acceptance criteria

- [~] `daemon.list` over the control socket reaches `running` or `stopped` without page action, and `daemons.json` exists with mode 0600. I did not run it over the real socket. The launch probe, the runner and the engine's registry write are each tested, but not end to end. It still needs the WebDriver-container smoke from the task's test plan.
- [x] `ui.inspect` and boot hold the same view, with no password or pairing link.
- [x] `engine_command` refuses `daemon.switch` and `command.list`.
- [~] `storage_set` and `settings.get` answer while a start runs. Tested with the fake CLI in `slow` mode (0.4 s), not the 10 s `sleep` mode the task names.
- [~] `daemon_resolve_current` returns the address and password for a direct entry. I did not add a test that scans the run's log for them; the existing `secret_guard` test is unchanged. The new code logs no secrets (`dial_for_page` is the only place a password goes into JSON, and the runner logs only state names).
- [x] `daemon.add` gives one `daemons_changed` event, asserted where it is emitted with a fake emitter.
- [x] `cargo xtask ci` passes.

## Follow-ups

- **Event ACL cannot be scoped to names.** Tauri has no per-name scope on `core:event:allow-listen`. The page can therefore listen to any event, though the app emits only `daemons_changed` and `daemons_manage`. I changed the capability description and the test accordingly.
- **`ask`'s 60 s deadline** also bounds the control socket's `daemon.local.*` requests. They only queue, so they return at once.

## Proposed doc edits

- **`desktop/AGENTS.md` "Where it stands":** replace "(`daemon.*`, not yet used by the window)" with "The window opens the registry at launch, probes the local daemon in a background runner, carries the registry view in the boot snapshot (`daemons`, `app.minDaemonVersion`) and tells the page of changes with `daemons_changed`; the page reaches it through `engine_command` (ten allowed ids) and `daemon_resolve_current`."
- **`docs/architecture.md` § The webview boundary:** the page may call 14 commands, adds `engine_command` and `daemon_resolve_current`, and may listen for events. Only `daemon_resolve_current` returns a secret.

## Wave gate (orchestrator)
```
Orchestrator: cargo xtask ci (8 steps) passed. Control-socket end-to-end smoke deferred to task-006 live checks.
```
