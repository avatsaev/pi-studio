# Task 005 — The desktop app says why a daemon did not start — Summary

- **Sprint:** sprints/sprint-155-damaged-files
- **Completed:** 2026-11-25
- **Status:** done

## What was implemented
`parse_answer` reads the `error` field of a `{"up":false}` line from `daemon start` / `restart`: `unprotected_bind` and `config_unreadable` become new `FailReason` / `RemoteFailReason` values; an unknown code, a non-text code or a missing field stays `not_healthy`; a down `status` is still `stopped`. For `config_unreadable` the state carries the path of `<home>/config.json` in its existing `output` field (the local home, or the host's folder over SSH; the CLI line has no path). The Daemons screen shows one label and one notice per reason (set a password with `pi-studio daemon set-password` or listen on 127.0.0.1 only; repair or remove the file, path shown) and Retry starts again, for local and SSH entries. The new codes are also page error codes with banner messages.

## Files changed
Rust: `desktop/crates/model/src/registry.rs`, `crates/shell/src/{cli_answers,supervisor,daemons,remote_supervisor,shell_env}.rs`, `remote_supervisor/scripts.rs`, their tests and `tests/fixtures/fake-pi-studio.sh`; app: `desktop/apps/pistudiodesktop/src/host/{daemons,daemons-view,daemons-view.test}.ts`; workbench: `host/types.ts`, `features/daemons/{daemon-presentation,daemons-screen-view}.ts` and tests; docs: `desktop/AGENTS.md`, `desktop/docs/architecture.md`, `desktop/docs/control-protocol.md`, `packages/workbench/AGENTS.md`.

## Build & test results
```
cd desktop && cargo fmt --all && cargo xtask ci -> all 8 steps passed (fmt, web, clippy, layers, test, panic_hunt, doctest, wasm)
npx vitest run packages/workbench/src/features/daemons -> 9 files, 224 passed; desktop app npx vitest run src/host -> 11 files, 240 passed
Full-tree gate: build, typecheck 0 errors; lint 0 errors; npm test (three runs) 349 files, 5087 tests passed
```

## Acceptance criteria
- [x] Rust tests: both codes parse to their reasons; an unknown code and a missing field parse as before
- [x] Presentation tests: each reason has its own text; no raw code is shown
- [x] `cargo xtask ci` passes

## Follow-ups / TODO(verify)
- Over SSH `unprotected_bind` is practically unreachable (the app binds the host daemon to 127.0.0.1); handled anyway.
- Not seen in the running desktop app (sprint-156/task-005 says so if it cannot run it).
