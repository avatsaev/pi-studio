# Task 003 — Documents and spec close for the registry; milestone 1 closed — Summary

- **Sprint:** sprints/sprint-111-desktop-daemon-registry-close
- **Completed:** 2026-11-20
- **Status:** done (documents only). Done second, in the same pass as sprint-106/task-003.

## What was implemented
- **`swe/features/desktop-daemon-registry.md`**
  - Status line: built, checked live on Linux; 13 of 17 criteria ticked; four open; macOS and Windows not run (sprint-111/task-002, `desktop/docs/platform-checks.md`).
  - Acceptance criteria, each with a pointer (`sprint-109/task-006 check N`, `sprint-110/task-007 check N`, `sprint-111/task-001`). **Left open, and why:**
    - a CLI from a real Node version manager: the shell mechanism passed (bash, zsh, fish, negative control), nvm/fnm/volta/Homebrew and the macOS Dock did not run (R1);
    - relay `wrong_key`: a rotated key looked like `daemon_offline`, so the marker was not reached live (the unit test covers it); Replace link with name and layout kept passed;
    - `daemons.json` mode 0600 on macOS: Linux passes, macOS open (R4);
    - Windows: the local entry's `unsupported` (R7), unit tests only.
  - P1–P7 folded into the contract: `checking` in `LocalState`; `daemon.local.*` (refresh included) answer `{ accepted: true }`, with the errors as the engine behaves (`busy`, `unsupported`, CLI errors except for `refresh`); error text is the code; `HostDaemons` with `settings` and `setSettings` (full interface shown); the page reaches the engine through `engine_command` (ten ids), `daemon_resolve_current` and `daemon_switch`, with the events `daemons_changed` and `daemons_manage`; the current entry in the native menu does nothing; the stop confirm belongs to the caller and the window reacts to `stopping`; the dead-link marker is in memory; the app reads the CLI's answer whatever its exit code. Also recorded: `daemon start` always listens on 6767; the drop-`storage_set`-until-`boot` rule of a switch (the layout-leak bug); Retry on the Daemons screen does not connect, Start does (the Start bug).
  - TODO(verify): `minDaemonVersion` (built as 0.0.119, notice seen), shell environment (bash/zsh/fish found it, banner harmless, an 8 s start-up file gave `cli_missing` after ~5 s with no hang, `/bin/sh` gave `cli_missing`), the 90 s limit (first start measured 1.2–2.1 s; a slow one not measured), a new `wrong_key` against `daemon_offline` entry, other homes and 6767, WSL2 (not tried), macOS and Windows (not run).
- **`swe/features/desktop-native-host.md`**: the three registry criteria ticked with evidence (sprint-110/task-007 check 5; sprint-106/task-001 check 4 and sprint-111/task-001; the `ui.inspect` view); the boot snapshot shows `daemons` and `minDaemonVersion` as built (done in the same edit as the sprint-106 task).
- **`swe/architecture/workbench-host-adapter.md`**: `daemons` and `app.minDaemonVersion` are in the main contract; the amendment is a History table.
- **Indexes:** `swe/MAIN-SCOPE.md` (rows and the two open-checks entries) and `swe/sprints/PLAN.md` (open questions: tried command list, measured save, `daemon_offline` answer, shell environment, 90 s, IPC benchmark; the coverage row).
- **Desktop and repository documents:** `desktop/AGENTS.md` ("Where it stands", rule 10 on secrets), `desktop/docs/architecture.md` (new "The registry and the local daemon": the registry file and its caps, the supervisor, the shell environment and the CLI lookup, the native menu, where secrets live and travel, that `*.corrupt-*` files may hold old secrets), `desktop/README.md`, root `AGENTS.md`, `docs/desktop-client-handoff.md` (milestone 1 done for Linux, what is open, milestone 2 starts with the IPC benchmark), `packages/cli/AGENTS.md` (the answer is read whatever the exit code, the limits, port 6767).

## Files created / changed
As in the sprint-106 summary; this task's share is the registry spec, the architecture section, the CLI contract paragraph, the handoff's milestone text and the PLAN/MAIN-SCOPE open entries.

## How it satisfies the scope
The host adapter spec is `host/types.ts` member by member (see the sprint-106 summary for the list). No document says the desktop app has no registry or asks for the address after every launch.

## Verification
- `rg -n -i "not built|not planned|neither built" swe/features/desktop-*.md swe/MAIN-SCOPE.md docs/desktop-client-handoff.md`: no hit remains (the three earlier hits are rewritten).
- Host adapter comparison with `host/types.ts`: agrees; `HostDaemons` has `snapshot()` with `settings`, `setSettings`, `onManageRequest`.

## Build & test results
```
$ cd desktop && cargo xtask ci
CI summary: all 8 steps passed (fmt, web, clippy, layers, test, panic_hunt, doctest, wasm)
$ npm run build        # exit 0
$ npm run typecheck    # exit 0
$ npm run lint         # exit 0 (warnings in packages/server tests, none new)
$ npm test             # 291 files, 4129 tests passed
```
`npm run fmt:check` was not counted (it failed on 28 files before this work).

## Acceptance criteria
- [x] No acceptance box in either spec is ticked without evidence, and none that failed is ticked.
- [x] The host adapter spec's main contract matches `host/types.ts` member by member.
- [x] Every planning-time decision listed is in the registry spec.
- [x] No document says the desktop app has no daemon registry, asks for the address after every launch, or lists the registry as not built.
- [x] `cargo xtask ci`, `npm run build`, `typecheck`, `lint`, `test` pass.

## Follow-ups / TODO(verify)
- Open in the registry spec: version managers and the macOS Dock (R1), `wrong_key` live, mode 0600 on macOS (R4), Windows (R7), WSL2 (R8), a slow first start, `minDaemonVersion` at first release. All need sprint-111/task-002 (blocked, a person with those machines).
- The IPC benchmark that opens milestone 2 is in no spec and has no task (PLAN open question, handoff).
- Not fixed, found by the live runs: the switcher pill's tooltip overlays the first list row; with the CLI missing the connection-bar error text runs behind Retry; after removing the current entry the sidebar kept the old workspace row; `daemon rotate-key` restarts the daemon and then tries to bind 6767 (sprint-110/task-007).
