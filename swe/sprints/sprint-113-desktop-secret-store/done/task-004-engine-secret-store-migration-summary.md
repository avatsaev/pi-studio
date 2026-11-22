# Task 004 — Engine: the secret store in `Session`, migration at launch, the dial answer from the store — Summary

- **Sprint:** sprints/sprint-113-desktop-secret-store
- **Completed:** 2026-11-21
- **Status:** done

## What was implemented
- `Session::with_config_dir(dir, store)` takes an `Arc<dyn SecretStore>`; `Session::new()` uses memory; `Session::secret_store()`. The registry in memory is `RegistryV2`.
- **Migration at load:** a version 1 `daemons.json` has each secret stored, then is rewritten as version 2; a second load changes nothing and calls the store zero times. If a store call fails the file stays byte for byte, one `secrets_not_moved` notice is returned, the run serves secrets from memory, and `daemon.add/update/remove` answer `secret_store_failed` while secrets are held back (a version 2 file must not claim secrets only this run has).
- **Blocking rule (decided and written in `desktop/docs/architecture.md` § Decisions, two rows, and § Threads):** the session never calls the store from a command or request path except at launch (migration) and, for now, in `daemon.add/update/remove`. `Session::plan_dial` is pure and returns a `DialPlan` (a final `Dial`, or `Password { url, entry }` / `PairingLink { entry }`); `DialPlan::finish(&dyn SecretStore)` does the blocking read on the caller's thread. `OwnerAccess` in shell holds the store and finishes plans there; `LocalAccess for Mutex<Session>` plans under the lock and reads outside it. A missing item is `secret_missing`; an unreadable store is `secret_unavailable`.
- **Model:** the version 1 public types and encoder are removed (reader private); version 2 gains `add`, `update`, `remove`, `set_last_used`, `views`, `EntryV2::view`, a secret-free `NewEntry` and `Update`, `check_password`, `check_link`. A model bug found and fixed: `into_v2` left `"version":1` in the unknown fields, so a migrated file would have been written as version 1 (a test now reads the written file back).
- `daemon.add/update/remove`: secret stored first, then the file; a clear removes the item; remove deletes after the file write.
- Apps: the app binary passes the memory backend (see the decision below), the CLI uses a `FileStore` (`secrets.json` under `--config-dir`). Frontend: `host/boot.ts` and `main.tsx` accept and word the new notice kind (without it the page would have rejected `boot`).
- Files: engine `secret.rs`, `secret/tests.rs`, `test_store.rs`, `daemon_cmds/tests.rs` (new), `lib.rs`, `session.rs`, `storage.rs`, `local.rs`, `daemon_cmds.rs`, `Cargo.toml`; model `registry.rs`, `lib.rs`; shell `Cargo.toml`, `src/{daemons,owner_access,supervisor,owner,menus,switch,page}.rs`, `tests/secret_guard.rs`; both app crates; `apps/pistudiodesktop/src/{host/boot.ts, host/boot.test.ts, main.tsx}`; `desktop/docs/{architecture,development}.md`, `desktop/AGENTS.md` (rule 10 and the summary paragraph).

## Results
```
engine 57 passed;  shell 142 passed (includes the 3.00 s blocking test);  app 40 + 6 + 1;  model 21;  panic_hunt (ignored) 1 passed
a store blocking 3 s on every call: storage_set and a control request made meanwhile answered in under 100 ms; the resolve took at least 2.9 s
```

## Wave gate (orchestrator, combined tree, 2026-11-21)
```
$ (cd desktop && cargo xtask ci)     all 8 steps passed (fmt, web, clippy, layers, test, panic_hunt, doctest, wasm)
$ npm run build && npm run typecheck && npm run lint && npm test     all exit 0; 291 files, 4132 tests passed
$ (cd desktop/apps/pistudiodesktop && npm run check && npm run lint && npm test)     exit 0; 112 tests passed
```

## Acceptance criteria
All six met.

## Decision recorded: the app binary loses secrets on restart until task-006
The app still passes the memory backend (its configuration directory is known only after the Tauri builder runs): a real version 1 `daemons.json` would be migrated into memory and rewritten as version 2, losing the secrets at exit. Task-006 gives the app the real choice before the session opens a real directory; nothing is released between the two. Task-005 and task-006 were amended accordingly.

## Follow-ups / TODO(verify)
- `DaemonErrorCode` in `packages/workbench` and `CODES` in `host/daemons.ts` lack the three new codes (task-006).
- The `secrets.json` reset notice (`Opened.reset`) is not turned into a notice yet (task-006).
- Migration runs on the owner thread at spawn, before it serves anything: an exception to "never on the owner thread", read as "at launch". A prompt during migration is untested (fake and memory stores only).
- `desktop/docs/platform-checks.md` R4 still says the password is in `daemons.json` (task-008).
