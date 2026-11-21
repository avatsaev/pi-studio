# Task 004 — Engine: the secret store in `Session`, migration at launch, the dial answer from the store

- **Sprint:** sprint-113-desktop-secret-store
- **Status:** backlog
- **Type:** feature
- **Area:** desktop/crates/engine, desktop/crates/shell
- **Priority:** P1
- **Estimated size:** M
- **Depends on:** task-001, task-003

## Goal
A session keeps its registry in version 2 and its secrets in a store given to it, and moves a version 1 file's secrets over at launch.

## Context / why
P3 and P5. The page still receives a direct entry's password in `daemon_resolve_current` until sprint 116: only where the secret is kept changes here. A keychain call may block on a system prompt, and the owner thread must keep answering storage writes, the control socket and dialogs meanwhile.

## Scope references
- `swe/features/desktop-transport-bridge.md` § 5 (blocking; engine commands), § Launch and migration, § TODO(verify) ("How the engine reaches the store without blocking the owner thread")
- `desktop/crates/engine/src/session.rs`, `local.rs` (`resolve_current`, `Dial`), `storage.rs`
- `desktop/crates/shell/src/owner.rs`, `owner_access.rs`, `daemons.rs` (`dial_for_page`), `supervisor.rs` (how slow work stays off the owner thread today)
- `desktop/crates/shell/tests/secret_guard.rs`
- `desktop/docs/architecture.md` § Threads, § The five seams

## What to build
- `Session::with_config_dir` takes the secret store to use; `Session::new()` uses the memory backend.
- At load: a version 1 `daemons.json` is migrated. Each secret is stored; when all succeeded, version 2 is written. When one fails, the version 1 file is left as it is, this run serves secrets from what was read, and one notice is returned.
- The registry in memory is the version 2 document; the version 1 types and their encoder are removed.
- The dial answer for the current entry reads the password or the pairing link from the store.
- **Decide and build how store calls stay off the owner thread.** Either the caller runs the store step before and after a command, or a hook in the style of `Services` that the owner never waits on. Write the choice into `desktop/docs/architecture.md` § Decisions.
- A missing item for an entry whose `hasPassword` is true is the error `secret_missing`.

## Out of scope
- `daemon.add`, `daemon.update`, `daemon.remove` (task-005).
- Removing the password from the page's answer (sprint 116).

## Acceptance criteria
- [ ] Given a configuration directory with a version 1 file, after a load the file is version 2 with no secret and the store holds each one; a second load changes nothing.
- [ ] Given a store whose `set` fails, the version 1 file is byte-identical afterwards, a notice is returned once, and the dial answer still has the password.
- [ ] Given a fake store that blocks for 3 s on every call, a `storage_set` and a control request made meanwhile are answered within 100 ms.
- [ ] The dial answer for a direct entry with a password carries it, read from the store; with the item deleted behind the app's back it is `secret_missing`.
- [ ] The secret guard test passes with secrets in the store.
- [ ] `cargo xtask ci` passes, including the wasm step.

## Test / verification plan
- `cargo test -p pistudiodesktop-engine -p pistudiodesktop-shell`
- `cargo xtask ci` in `desktop/`

## Notes
- The corrupt-file path is unchanged: a `daemons.json` that cannot be read is set aside and may hold old secrets.
- The app binary and the app's CLI must keep compiling: they pass the memory backend here, and task-006 gives them the real choice.
