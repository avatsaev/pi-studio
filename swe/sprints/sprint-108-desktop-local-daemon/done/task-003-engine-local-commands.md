# Task 003 — Engine: local daemon state and the `daemon.local.*` commands

- **Sprint:** sprint-108-desktop-local-daemon
- **Status:** done
- **Type:** feature
- **Area:** desktop/crates/engine
- **Priority:** P1
- **Estimated size:** M
- **Depends on:** sprint-107/task-005

## Goal
The engine owns the local daemon's state and its four commands. A command only records what was asked; the work happens outside the engine and its outcome comes back as a state change.

## Context / why
The engine is pure: it builds for wasm32 and its command test runs every command with hostile input, so it cannot start processes. The spec also says an action returns once accepted and that a second one is refused while the first runs. Both point at the same shape: commands queue a request, the host runs it, the engine applies the result.

## Scope references
- `swe/features/desktop-daemon-registry.md` § Public contract 2 (`daemon.local.*`, `LocalState`), § Local daemon state, § Launch (`resolveCurrent`), § Public contract 6
- `desktop/crates/engine/src/` (`session.rs`, `daemon_cmds.rs`, `commands.rs`), `desktop/crates/engine/tests/panic_hunt.rs`
- `desktop/crates/model` (`LocalState`, the registry: sprint-107/task-001)

## What to build
- **Commands:**
  | Command | Result | Refused with |
  |---|---|---|
  | `daemon.local.start` | `{ accepted: true }` | `unsupported`, `cli_missing`, `cli_outdated`, `busy` |
  | `daemon.local.stop` | `{ accepted: true }` | the same |
  | `daemon.local.restart` | `{ accepted: true }` | the same |
  | `daemon.local.refresh` | `{ accepted: true }` | `unsupported`, `busy` |
  An accepted start or restart sets the state to `starting`, a stop to `stopping`; a refresh leaves the state as it is. Each adds one request (`start`, `stop`, `restart`, `probe`) to a queue the host drains.
- **Busy:** from the moment an action is accepted until its outcome is applied, another action is refused with `busy`. A refresh while a refresh is pending is accepted once (they merge).
- **Applying an outcome:** the host hands back the new `LocalState` for the request it ran; the engine stores it, clears busy and marks the registry view as changed.
- **The answer to "what do I dial for the current entry"**, as a session function, not a command (it returns secrets):
  | Current entry | Answer |
  |---|---|
  | none | error `no_current` |
  | `direct` | `{ url: address, password?, connect: true }` |
  | `relay` | `{ url: pairingLink, connect: true }` |
  | `local`, state `unsupported`, `cli_missing`, `cli_outdated` | that code |
  | `local`, `running(host, port)` | `{ url, password?, connect: true }`, the URL built by the caller's dial-address function |
  | `local`, `stopped`, `autoStartLocalDaemon` on | "start needed" |
  | `local`, `stopped`, setting off | error `local_stopped` |
  | `local`, `failed(reason)` | that reason |
  | `local`, `checking`, `starting`, `stopping` | "wait" |
- `cli_missing` and `cli_outdated` do not block a refresh: Retry in the Daemons screen is a refresh.

## Out of scope
- Running the CLI and producing outcomes (task-004).
- Confirms and what the window does on stop (sprint-109, sprint-110).

## Acceptance criteria
- [ ] `daemon.local.start` from `stopped` answers `accepted`, the state is `starting`, and one `start` request is queued.
- [ ] A second action before the outcome answers `busy` and queues nothing.
- [ ] Applying `running(host, port)` clears busy; the next `daemon.list` shows it.
- [ ] In a session opened as "no local daemon here", all four commands answer `unsupported` and nothing is queued.
- [ ] `daemon.local.start` in `cli_missing` answers `cli_missing`; `daemon.local.refresh` in `cli_missing` is accepted.
- [ ] Each row of the dial table has a test; the direct and local answers carry the stored password, and nothing else in the engine returns one.
- [ ] The adversarial command test passes: no command starts a process, whatever its input.

## Test / verification plan
- `cargo test -p pistudiodesktop-engine --lib --tests`
- `cargo test -p pistudiodesktop-engine --test panic_hunt -- --ignored`
- `cargo xtask wasm`

## Notes
- **Found at planning time:** the spec says `daemon.local.refresh` returns the `LocalState` after probing. A probe runs the CLI for up to 15 s and cannot run inside a command, so `refresh` answers `{ accepted: true }` like the other three and the state arrives as a change. sprint-111/task-003 records it in the spec.
- Runs in parallel with task-001 and task-002: the engine crate against the shell crate.
- The secret-leak guard of sprint-107/task-005 is extended with these four commands.
