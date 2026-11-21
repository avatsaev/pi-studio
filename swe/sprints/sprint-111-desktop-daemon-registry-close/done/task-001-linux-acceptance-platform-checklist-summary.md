# Task 001 — Linux acceptance run for the registry, and the platform checklist extended — Summary

**Sprint:** sprint-111-desktop-daemon-registry-close · **Completed:** 2026-11-20 · **Status:** done. No criterion failed on Linux; macOS/Windows parts and a real version manager are open.

## `desktop-daemon-registry.md` § Acceptance criteria on Linux
| # | Criterion | Result | Evidence |
|---|---|---|---|
| 1 | First launch: local daemon started, connected, nothing typed | pass | sprint-110/task-007 check 1 (connected in 2.1 s; first `daemon.local.start` 1.2 s in sprint-109/task-006) |
| 2 | A daemon started from a terminal is adopted; `started: false` | pass | sprint-109/task-006 check 2 (same pid before and after, also after a relaunch); the app only reads `status`, never starts a running daemon |
| 3 | Quit with an agent running: daemon and agent still running | pass | sprint-110/task-007 check 15 (a streaming turn against a fake model; `pi` processes and the daemon survived) |
| 4 | No CLI: screen explains and gives the install command; a direct entry can be added and connected | pass | sprint-110/task-007 checks 3 and 5 |
| 5 | CLI from a version manager, app started without a terminal: found | pass for the shell mechanism; real manager open | this run, `env -i` launch with the CLI on `PATH` only through the shell's start-up files: **bash**, **zsh**, **fish** each `running`; negative control (`SHELL=/bin/sh`, no rc) → `cli_missing`. nvm/fnm/volta/Homebrew themselves: checklist R1 |
| 6 | `cliPath` at a missing file: `cli_missing` naming the path | pass | sprint-109/task-006 check 4 |
| 7 | Three entries chosen in the native menu: reload, connect, last layout | pass | sprint-110/task-007 check 5 (local, direct with password, relay; layouts of 1, 2, 3 panes kept apart after the layout-leak fix) |
| 8 | Opens on the last used entry; unreachable: reconnecting state, switcher switches | pass | sprint-110/task-007 check 6 (the state shown is "connection failed" with Retry) |
| 9 | Remove: secret and state gone; local offers no Remove; `local_not_removable` | pass | sprint-110/task-007 check 8; `daemon.remove local` → `local_not_removable` (this run) |
| 10 | Duplicate name in another case: `name_taken` | pass | this run (`X` then `x` over the control socket); the form message in sprint-110/task-007 check 5 |
| 11 | Transfer running, another entry chosen: native confirm; "no" changes nothing | pass | sprint-110/task-007 check 13 (a real 1 GiB download) |
| 12 | Relay `wrong_key`: marker; new link connects with name and layout kept | partly | a rotated key shows **`daemon_offline`** through this relay, so the marker could not be reached live (unit test covers it); "Replace link" connected with name and 3-pane layout kept (sprint-110/task-007 check 12) |
| 13 | `daemons.json` 0600 on Linux; no log line or answer holds a password, pairing link or `pairingUrl` | pass on Linux | modes 0600 (also on `daemons.json.corrupt-*`); scans of the app logs (56 + 85 lines) and the control answers found none. macOS: checklist R4 |
| 14 | Daemon older than `minDaemonVersion`: connects, one notice naming both | pass | sprint-110/task-007 check 14 |
| 15 | Windows: local entry shows the explanation and no Start; `unsupported` | not applicable on Linux | checklist R7; unit tests cover the answer |
| 16 | Web client: connection bar unchanged, no Daemons screen | pass | sprint-110/task-007 check 16 |
| 17 | Every § 2 command runnable from the control socket and the CLI, with tests; adversarial test covers them | pass | commands run over the socket in sprint-109/task-006 (`control-protocol.md`); the engine's tests |

## The three native-host criteria that needed the registry
- Separate layouts for A and B with a shared theme: **pass** (sprint-110/task-007 check 5).
- A corrupt `daemons.json`: **pass** — the app opened on the local entry only, the file was kept as `daemons.json.corrupt-20261120T211837Z` (0600), one notice.
- `ui.inspect` returns the registry view: **pass** (`daemons` and the menu model; `control-protocol.md`).

## Shells (no terminal)
| Shell | Result |
|---|---|
| bash (login + interactive) | CLI found, local daemon `running` |
| zsh | found |
| fish 4 | found |
| bash, start-up file prints a banner | found (the markers isolate the output) |
| bash, start-up file takes 8 s (the limit is 5 s) | `cli_missing` after ~5 s, no hang, the control socket kept answering; the user can set `cliPath` |
| `/bin/sh`, no start-up files | `cli_missing` |

## Checklist
`desktop/docs/platform-checks.md` (created in sprint-106/task-001) carries the registry table R1–R8, each with steps and the expected result.

## Gates
`cargo xtask ci`: 8 steps passed.
