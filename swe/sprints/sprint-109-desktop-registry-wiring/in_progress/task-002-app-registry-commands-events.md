# Task 002 — App: the registry at launch, in the boot snapshot, and reachable from the page

- **Sprint:** sprint-109-desktop-registry-wiring
- **Status:** in_progress
- **Type:** feature
- **Area:** desktop/apps/pistudiodesktop/src-tauri (+ desktop/crates/shell)
- **Priority:** P1
- **Estimated size:** M
- **Depends on:** sprint-108/task-004, sprint-105/task-003

## Goal
The running app opens the registry, probes the local daemon in the background, carries the registry view to the page in the boot snapshot, lets the page run registry commands and ask what to dial, and tells the page when anything changed.

## Context / why
The engine and the supervisor exist but nothing in the app calls them. The page can call only the commands the app lists (sprint-103/task-001), so each new reach has to be added on purpose, and the one that returns secrets has to be a command of its own.

## Scope references
- `swe/features/desktop-daemon-registry.md` § Launch, § Public contract 1 (secrets reach the webview only through `resolveCurrent`), § Public contract 3, § Local daemon state (when a probe runs)
- `swe/features/desktop-native-host.md` § Public contract 1 (boot snapshot: `daemons`, `app.minDaemonVersion`), § Public contract 5 ("Tauri commands for the page", "Events"), § Public contract 6
- `desktop/apps/pistudiodesktop/src-tauri/src/` (`main.rs`, `bridge.rs`: the thread that owns the session; the page commands module; `services.rs`), `build.rs`, `capabilities/default.json`
- `desktop/crates/shell` (the pump and resolve-current: sprint-108/task-004)

## What to build
- **At launch:** the session opens the registry (sprint-107/task-003) with "no local daemon here" on Windows; the native process hooks are wired in; a first probe is queued. The window does not wait for it.
- **A background runner** for local daemon requests: it drains the session's queue through the pump off the session's thread, so storage writes, the control socket and dialogs keep working during a 90 s start.
- **Boot snapshot** gains `daemons: { currentId, entries, local, settings }` (no secret) and `app.minDaemonVersion` (the constant `0.0.119`, in one place).
- **Page commands**, added to the command list and the capability file:
  | Command | Input | Answer |
  |---|---|---|
  | `engine_command` | `{ id, params }` | the command's result, or its error text. Allowed ids only: `daemon.list`, `daemon.add`, `daemon.update`, `daemon.remove`, `daemon.local.start`, `.stop`, `.restart`, `.refresh`, `settings.get`, `settings.set`. Any other id is refused |
  | `daemon_resolve_current` | none | `{ url, password?, connect: true }` or an error code. Waits for a pending probe or start; never blocks the session's thread |
  `daemon.switch` is not on the list: a switch needs a confirm, a flush and a reload (task-003).
- **Event to the page:** `daemons_changed`, carrying the same view as the snapshot, sent after every change to the registry, the local state or the two settings. The page's capability allows listening to this event and to `daemons_manage` (sent by task-004), and nothing else.
- The control socket's `ui.inspect` and commands see the same session, so a change made there reaches the page through the same event.

## Out of scope
- The switch (task-003), the native menu (task-004), the frontend (task-005).
- Anything the workbench draws.

## Acceptance criteria
- [ ] With `--config-dir <tmp>` and `cliPath` set to the fake CLI of sprint-108/task-004: after launch, `daemon.list` over the control socket reaches `running` or `stopped` without any page action, and `<tmp>/daemons.json` exists with mode 0600.
- [ ] `ui.inspect` and the answer of `boot` hold the same registry view; neither holds a password or a pairing link.
- [ ] `engine_command` with an id outside the list (for example `daemon.switch` or `command.list`) is refused.
- [ ] While a start is running (fake CLI sleeping 10 s), `storage_set` and `settings.get` over the control socket still answer at once.
- [ ] `daemon_resolve_current` on a direct entry returns its address and password; no log line of the run contains them.
- [ ] `daemon.add` over the control socket produces one `daemons_changed` event for the page (asserted where the event is emitted, with a fake emitter).
- [ ] `cargo xtask ci` passes.

## Test / verification plan
- `cargo test -p pistudiodesktop-shell` (the allowed-id check and the "who is told about a change" decision are pure functions there)
- `cargo xtask web && cargo xtask ci` in `desktop/`
- Control-socket smoke in the WebDriver container: launch with `--control 0 --config-dir <tmp>`, add an entry, read the file.

## Notes
- Depends on sprint-105/task-003, the last task of the native-host plan to change `main.rs`, the command list and the capability file.
- `minDaemonVersion` 0.0.119 is the spec's proposal, to be confirmed when the app is first released (spec TODO).
- The page is trusted with the entry it opens and no other: `daemon_resolve_current` takes no id.
