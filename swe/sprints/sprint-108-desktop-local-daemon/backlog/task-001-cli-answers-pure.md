# Task 001 — Reading the `pi-studio` CLI's answers (pure functions)

- **Sprint:** sprint-108-desktop-local-daemon
- **Status:** backlog
- **Type:** feature
- **Area:** desktop/crates/shell
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** sprint-107/task-005

## Goal
Everything the app decides from the CLI's output is a pure function with tests: which line is the answer, what it means, whether the CLI is recent enough, and which address to dial.

## Context / why
The app drives the local daemon only through `pi-studio --json daemon ...` (option A: no bundled daemon). That output is text from another program. Parsing it apart from the code that spawns processes means every odd case can be tested without a process.

## Scope references
- `swe/features/desktop-daemon-registry.md` § Public contract 7 (what the app expects from the CLI), § Local daemon state, § Finding and running the CLI (`cli_outdated`)
- `swe/features/desktop-client-protocol-followups-2.md` § 3 (the `--json` shapes)
- `packages/cli/src/daemon-commands.ts` (`status`, `ensureLocalDaemonAndPair`, `stop`: the real outputs and exit codes), `packages/cli/src/program.ts` (`--version`)
- `desktop/crates/shell/src/` (a new module; `lib.rs`), `desktop/crates/model` (`LocalState`: sprint-107/task-001)

## What to build
- **Answer line:** the last non-empty line of standard output, parsed as a JSON object. Anything else is `bad_output`. The exit code is not used to decide: the CLI exits non-zero while printing a valid answer (`status` when the daemon is down, `start` with `no_keypair`).
- **Meaning:**
  | Command | Answer | Result |
  |---|---|---|
  | `daemon status` | `up: true` with `host`, `port` | running(host, port) |
  | | `up: false` | stopped |
  | `daemon start`, `daemon restart` | `up: true` (with or without `error: "no_keypair"`) | running(host, port) |
  | | `up: false` | failed(`not_healthy`) |
  | `daemon stop` | `stopped: true` or `false` | stopped |
  | any | a required field missing or of the wrong type | failed(`bad_output`) |
  `pairingUrl` is dropped during parsing: the parsed value has no field for it.
- **Version:** read a semantic version from the output of `--version` (surrounding whitespace allowed, a leading `v` allowed); compare with 0.0.119; lower is `cli_outdated` carrying the version, unreadable is `bad_output`.
- **Dial address:** `ws://<host>:<port>`. An unspecified bind address (`0.0.0.0`, `::`) is dialled as the loopback address of the same family; an IPv6 host is bracketed.
- **Time limits** as named constants: version 5 s, status 5 s, start 90 s, restart 90 s, stop 15 s.

## Out of scope
- Spawning anything, finding the CLI, the shell environment (task-002).
- State transitions and `busy` (task-003).

## Acceptance criteria
- [ ] Output with warnings before the JSON line, and with a trailing blank line, is parsed from its last non-empty line.
- [ ] Each row of the table has a test, including `up: true` with `error: "no_keypair"` giving running.
- [ ] A `start` answer containing `pairingUrl` parses, and the secret string appears in neither the parsed value's debug output nor any error.
- [ ] `0.0.118` is outdated; `0.0.119`, `0.0.122`, `0.1.0` and `v1.2.3` are not; `banana` is `bad_output`.
- [ ] `0.0.0.0:6767` dials `ws://127.0.0.1:6767`; `::` dials `ws://[::1]:6767`; `192.168.1.5` is kept.
- [ ] `cargo xtask wasm` passes (the module is pure).

## Test / verification plan
- `cargo test -p pistudiodesktop-shell`
- `cargo clippy -p pistudiodesktop-shell --all-targets -- -D warnings`
- `cargo xtask wasm`

## Notes
- **Found at planning time:** `daemon status --json` exits 1 when the daemon is down, and `daemon start --json` exits non-zero with `no_keypair` while the daemon is healthy. Treating a non-zero exit as failure would be wrong twice.
- Depends on sprint-107/task-005 only because both add to the shell crate.
