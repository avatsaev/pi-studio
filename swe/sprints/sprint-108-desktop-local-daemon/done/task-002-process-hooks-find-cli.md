# Task 002 — Process hooks: the shell environment, finding the CLI, running it with a time limit

- **Sprint:** sprint-108-desktop-local-daemon
- **Status:** in_progress
- **Type:** feature
- **Area:** desktop/crates/shell
- **Priority:** P1
- **Estimated size:** M
- **Depends on:** task-001, sprint-105/task-003

## Goal
The shell crate can find an installed `pi-studio` the way a terminal would, and run it with the user's shell environment and a time limit, behind hooks that tests replace with fakes.

## Context / why
D10. An app started from the dock or a launcher does not inherit the terminal's `PATH`. The CLI is a Node script, so both `pi-studio` and `node` must be found: the whole shell environment is needed, not only the CLI's location.

## Scope references
- `swe/features/desktop-daemon-registry.md` § Finding and running the CLI, § Error handling ("the shell environment cannot be read in 5 s"), § TODO(verify) ("Reading the shell environment")
- `desktop/crates/shell/src/services.rs` (`Services`: the hooks the app injects), `lib.rs`
- `desktop/apps/pistudiodesktop/src-tauri/src/services.rs`, `desktop/apps/pistudiodesktop-cli/src/main.rs` (the two binaries that need the native implementation)
- `desktop/AGENTS.md` (golden rules on services and on panics)

## What to build
- **Hooks** added to `Services`: run a program (path, arguments, environment, time limit) and get its standard output or one of "could not start", "timed out"; tell whether a path is an executable file; the current process environment; the user's home directory.
- **A native implementation with the standard library only**, shared by the app and the app's CLI, behind `cfg(not(target_arch = "wasm32"))`. A program that passes its time limit is killed, and its children are not left holding the output pipe open.
- **Shell environment**, read once per app run and again on request: run the user's shell (from `SHELL`, falling back to `/bin/sh`) as a login, interactive shell that prints its environment between two unique marker lines, with a 5 s limit. Only the text between the markers is parsed, so start-up files that print do not break it. On any failure the process's own environment is used.
- **Finding the CLI:**
  1. `cliPath` set: that file when it is executable, else `cli_missing` carrying the path;
  2. `pi-studio` on the shell environment's `PATH`;
  3. the usual install directories for npm and Node version managers under the home directory and the system prefixes (a named list in one place);
  4. else `cli_missing`.
- **Pure parts with their own tests:** the parser of the marked environment output, the `PATH` lookup over an injected "is executable" answer, the list of candidate directories for a given home.
- On Windows none of this is called: the local state is `unsupported`.

## Out of scope
- Deciding state from the answers (task-001, task-003), running daemon actions (task-004).
- Fish and other shells whose syntax differs: record what happens, do not special-case (see Notes).

## Acceptance criteria
- [ ] The environment parser reads a block wrapped in noise before and after the markers, values containing `=` and newlines, and returns nothing when a marker is missing.
- [ ] With fake hooks: a set `cliPath` that is not executable gives `cli_missing` with that path and no further search.
- [ ] With fake hooks: a CLI only in a version manager's directory under the home is found when `PATH` lacks it.
- [ ] A real test script that sleeps past its limit is reported as timed out and is no longer running afterwards (Unix-only test).
- [ ] A real test shell whose start-up file prints text still yields the right `PATH` (Unix-only test, with `SHELL` pointing at a script).
- [ ] A shell that never answers falls back to the process environment after the limit.
- [ ] `cargo xtask ci` passes, including the wasm step.

## Test / verification plan
- `cargo test -p pistudiodesktop-shell`
- `cargo xtask ci` in `desktop/`

## Notes
- Depends on sprint-105/task-003 because it is the last task of the native-host plan to change `Services` and the app's service wiring.
- The environment may hold tokens. It is passed to the CLI and never logged; a log line may name the shell and how long it took.
- Spec TODO(verify): the login-and-interactive approach was not tried. Record what happens with `bash`, `zsh` and, if installed, `fish` in the task summary; a shell that fails falls back and `cliPath` is the way out.
