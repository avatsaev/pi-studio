# Task 004 — Automated platform checks on macOS and Windows runners (daemon registry) — Summary

- **Sprint:** sprints/sprint-111-desktop-daemon-registry-close
- **Completed:** 2026-11-20
- **Status:** done. One workflow and one script with sprint-106/task-004, whose summary holds the files, the runs and the problems found on the way.

## What was implemented
The registry checks of that script: on macOS (control socket, a scratch `HOME` and `PI_STUDIO_HOME`, a free port, an emptied environment like the Dock's) `cli-found.zsh` and `cli-found.bash` (the CLI reachable only through the login shell's start-up file), `daemon-start`, `daemon-health`, `quit-leaves-daemon`, `daemon-stop`, `direct-entry` (mode 0600, no password in answers), `no-secret-in-log`, `cli-outdated` (fake CLI 0.0.118); on Windows `local-unsupported`, `switch` (two direct entries, separate layouts, shared theme) and `daemons-json`.

## Build & test results
```
Run 44835263318 (pull request #59, commit 5751855)
  macOS    14 passed (the registry ones: cli-found zsh/bash, daemon start/health/stop, quit-leaves-daemon,
           direct-entry, no-secret-in-log, cli-outdated)
  Windows  10 passed (local-unsupported, switch, daemons-json among them)
Desktop CI (cargo xtask ci) green on 5751855; app lint 0 warnings; 98 script tests pass.
```
**Negative control (local, then reverted):** with the shell-environment lookup removed from `read_with` in `crates/shell/src/shell_env.rs`, the macOS script run on Linux against the real CLI (Xvfb container) failed both `cli-found` checks with `cli_missing`; the baseline passed bash (zsh is absent from the image). The temporary line is gone (`rg TEMP-NEGATIVE` finds nothing).

## Printed facts
`daemon.local.start` 3.5 s (3.8 s in an earlier run) to `running`, against the 90 s limit. zsh found the CLI via `~/.zprofile` (shell answered in 160 ms), bash via `~/.bash_profile` (43 ms). macOS 15.8.2. Windows local state `unsupported` with the screen text "Not available on this system".

## Spec effect
`swe/features/desktop-daemon-registry.md`: two more criteria ticked (mode 0600 and no secret on macOS; Windows `unsupported`), 15 of 17. Open: a real Node version manager and a Dock launch (task-002), `wrong_key`.

## Open
"Also on failure" for daemons: a scratch home and a `finally` that stops what is left, shown by construction and by the green stop; no run failed while a daemon was up. The macOS job proves nothing about a window (the control socket answers without one). `daemon.local.start` answering `unsupported` on Windows is covered by unit tests only; the runner shows the state and the screen.
