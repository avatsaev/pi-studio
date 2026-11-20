# Task 002 — Process hooks: the shell environment, finding the CLI, running it with a time limit — Summary

**Sprint:** sprint-108 · **Status:** completed

## What was implemented
- **New `Services` hooks** (`services.rs`):
  - `run(&RunSpec) -> Result<String, RunFailure>`, where `RunFailure` is `CouldNotStart` or `TimedOut`.
  - `is_executable`, `env`, `home_dir`.
  - `list_dir`: an extra hook, needed so the nvm, fnm and asdf version directories can be listed.
- **`process.rs`** (native-only, std only), the implementation the app fills the hooks from:
  - `run` clears the environment and closes stdin and stderr.
  - On Unix the child runs in its own process group. On timeout the whole group is killed through the system `kill`, because the workspace forbids `unsafe`.
  - Output is read by a detached thread. After the program exits the output counts as complete once it has been quiet for 200 ms, so a leftover child holding the pipe cannot hold back the answer.
  - Also `is_executable`, `process_env`, `home_dir`, `list_dir`.
- **`shell_env.rs`** (native-only):
  - `parse_marked_env` is pure. It tolerates noise before and after the markers, and handles values with `=` and with newlines. It returns `None` if a marker is missing.
  - `read_with(services, limit)` runs `$SHELL` (else `/bin/sh`) with `-l -i -c 'printf BEGIN; env; printf END'`. The markers are random, and the limit is `SHELL_ENV_TIMEOUT` = 5 s.
  - Any failure falls back to the process environment.
  - `ShellEnv::get` reads once; `ShellEnv::refresh` reads again.
  - The log line names the shell and the elapsed time only, never the environment.
- **`cli_find.rs`**:
  - `find(services, env, cli_path) -> Result<PathBuf, CliMissing{path}>`.
  - Order: a set `cli_path` is the only place looked at. Then `PATH` from the shell environment. Then `candidate_dirs`, a pure list built from the named constants `HOME_BIN_DIRS`, `HOME_VERSIONED_DIRS` and `SYSTEM_BIN_DIRS`, with newest version first. Otherwise `CliMissing`.
  - Also `lookup_in_path`.
- **App wiring**: `src-tauri/src/services.rs` fills the five new hooks from `process`.
- **Test fix outside my file list**: the `recording()` helper in `apps/pistudiodesktop/src-tauri/src/commands/tests.rs` built `Services` without `..Default`. It no longer compiled, so I replaced its `pick_save_path: None` line with `..Services::default()`.
- **CLI binary**: `pistudiodesktop-cli` does not use `Services`, so it needed no change. The implementation lives in the shell crate, so it can use it later.

## Files
- `desktop/crates/shell/src/`: `services.rs`, `lib.rs`, new `process.rs`, `shell_env.rs`, `cli_find.rs`
- `desktop/apps/pistudiodesktop/src-tauri/src/services.rs`
- `desktop/apps/pistudiodesktop/src-tauri/src/commands/tests.rs` (one line)

## Build & test results
- `cargo test -p pistudiodesktop-shell`: 104 passed, plus the secret_guard test.
- `cargo clippy --workspace --all-targets`: clean.
- `cargo xtask ci`: all 8 steps passed (fmt, web, clippy, layers, test, panic_hunt, doctest, wasm).

## Acceptance criteria
- [x] The parser handles noise, `=` in values, newlines in values, and a missing marker (`shell_env::tests`).
- [x] A set `cliPath` that is not executable gives `cli_missing` with that path and no further search (`cli_find::tests`).
- [x] A CLI only under `.nvm/versions/node/<v>/bin` is found when `PATH` lacks it (fake hooks).
- [x] A real script that sleeps past its limit is `TimedOut`, and its child and group are dead afterwards (`process::tests`, Unix-only).
- [x] A real fake-shell script whose start-up prints text still yields the right `PATH` (`native_tests`, Unix-only).
- [x] A shell that sleeps past the limit falls back to the process environment.
- [x] `cargo xtask ci` passes, including wasm.

## Follow-ups
- **Real shells, tried here with stdin closed:**
  - bash works (`-l -i -c`). It prints "no job control" to stderr, which is discarded.
  - zsh printed a `gitstatus` error from this machine's own `.zshrc` and I did not capture its environment output (`head -4` cut it off).
  - fish is not installed.
  - A failing shell falls back to the process environment, and `cliPath` is the way out.
- The CLI's own directory is not prepended to `PATH` when it was found in a fallback directory. That is for task-003 or task-004 to decide.

## Proposed doc edits
- In `desktop/AGENTS.md`, under services, list the five new hooks and the `process`, `shell_env` and `cli_find` modules.
- Add to the spec's TODO(verify) "Reading the shell environment": bash works; zsh not confirmed (prints a `.zshrc` error); fish not tried.

## Wave gate (orchestrator)
```
Agent-run cargo xtask ci (8 steps) passed.
```
