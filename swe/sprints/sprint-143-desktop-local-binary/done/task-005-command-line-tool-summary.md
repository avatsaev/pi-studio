# Task 005 — The command-line tool — Summary

- **Sprint:** sprint-143-desktop-local-binary
- **Completed:** 2026-11-24
- **Status:** done

## What was built
- `shell/src/cli_tool.rs`: pure `state`/`install` over an injectable file-system seam (`Files`, real `StdFiles`) and the login shell's captured environment. States: `unavailable` (Windows, no home, or `current/pi-studio` not an executable file), `absent`, `occupied` (anything at `~/.local/bin/pi-studio` that is not a symlink to `$PI_STUDIO_HOME/bin/current/pi-studio`: file, folder, foreign or dangling symlink; relative targets resolved lexically), `not_on_path`, `shadowed{path}`, `installed`; PATH lookup uses absolute entries only. Install: `mkdir -p ~/.local/bin`, refuse when occupied (a file appearing between check and link is also refused), create the symlink, recapture the login shell's environment, answer the state; over our own link it only re-reads the environment ("Check again"); no binary = refused. The app never edits a shell file.
- `model::CliToolState` (serde pinned), engine `cli_tool_cmds.rs` (`CliToolHost`, `Session::set_cli_tool`; `cli_tool.state`, `cli_tool.install`), `Supervisor` as host, page `engine_command` runs both on a worker thread (the install can wait 5 s for the login shell); headless CLI supports `run --cmd cli_tool.state`.
- TypeScript: `HostDaemons.cliTool`, `cli-tool-presentation.ts`, `cli-tool-actions.ts`, `CliToolBlock.tsx` in the local settings under the auto-start switch: nothing for `unavailable`; `absent` an "Install the command-line tool" button; `not_on_path` the line `export PATH="$HOME/.local/bin:$PATH"` with Copy; `shadowed` the other path; `occupied` a file is in the way; "Check again" for the other non-installed states. State is read when the screen opens and when the local daemon's state changes.

## Results
Narrow: shell 311, engine 101, model 52, app 254, cli 10; clippy clean; layers and wasm ok; workbench daemons/host/test 291; desktop frontend 355. Sprint gate: `cargo xtask ci` 8/8, build/typecheck, lint 0 errors, 331 files / 4714 tests.

## Acceptance
- [x] Tests for every state (fake file system and shell lookup), `occupied` refusing. [x] `cargo xtask ci`, workbench tests.

## Not run / follow-ups
No live run in a real terminal or webview (145/001). Only a POSIX `export` line is shown for `not_on_path` (a fish user needs `fish_add_path`). The one test touching the real machine (`apps/pistudiodesktop-cli/tests/cli.rs`) uses `PATH=/usr/bin:/bin` and would see `shadowed` if `/usr/bin/pi-studio` existed.
