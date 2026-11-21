# Task 005 — Engine commands: add, update and remove with their secrets in the store — Summary

- **Sprint:** sprints/sprint-113-desktop-secret-store
- **Completed:** 2026-11-21
- **Status:** done

## What was implemented
`daemon.add`, `daemon.update` and `daemon.remove` make their store calls off the owner thread, with the `plan`/`finish` split the dial already uses. The ordering, `secret_store_failed` and the held-back refusal were already in place (task-004) and are unchanged.
- **Engine:** `SecretJob` (`secret_job.rs`) in four steps: `Session::plan_secret_command(id, params)` (pure, validates, builds the job); `SecretJob::store()` (calls before the file write; may block); `Session::commit_secret_job(&mut job)` (re-plans against the registry as it is, writes, builds the answer); `SecretJob::finish(committed)` (calls after the write; may block). A failed file write after an add, or an update whose entry vanished, takes the stored secret back. `Session::execute` still runs the four steps in a row; `execute_unlocked(&Mutex<Session>, ...)` does the split for a shared session (the CLI uses it). A failed delete on remove is logged with the entry id and the store's code, no secret, and the answer is `{"removed": true, "notices": [{"kind": "secret_not_removed", "entry": id}]}` (`notices` absent when all deletes worked; new `Notice::SecretNotRemoved`). `Session::add_entry`, `update_entry` and `remove_entry` are gone; `Vault` is `Clone`.
- **Shell:** `deferred.rs` hooked into `owner::serve_notifying`: each command is planned on the owner thread, its store step runs on a worker, the job returns through a channel inside `AppShell`, the loop commits it and a second worker runs `finish` and sends the reply. The loop polls every 20 ms only while a store step is outstanding; on quit `drain` waits up to 30 s for outstanding jobs. The browser build has no threads, so the commands run in place.
- Docs: `desktop/docs/architecture.md` (Decisions row, § Threads), `desktop/AGENTS.md` rule 10, the `secret.rs` module doc.
- Files: new `engine/src/secret_job.rs`, `shell/src/deferred.rs`; edited `engine/src/{daemon_cmds.rs, daemon_cmds/tests.rs, lib.rs, secret.rs, session.rs, storage.rs}`, `shell/src/{lib.rs, owner.rs, owner_access.rs}`, `shell/tests/secret_guard.rs`, `apps/pistudiodesktop-cli/src/main.rs`.

## Results
```
engine 60, shell 143 (+ secret_guard 1), app 40 + 6: all passed, twice;  panic_hunt (ignored) 1 passed
with a store that sleeps 600 ms per call: add, update and remove answer after the delay while storage_set and daemon.list answer in under 100 ms;
the entry is not listed before its secret is stored; hasPassword stays true until the delete finishes; daemons.json never holds a marker
a store whose deletes fail: remove reports one notice; the log line has the entry id and no secret
```

## Wave gate (orchestrator, combined tree, 2026-11-21)
```
$ (cd desktop && cargo xtask ci)     all 8 steps passed (fmt, web, clippy, layers, test, panic_hunt, doctest, wasm)
$ node --test desktop/apps/ipc-bench/page/*.test.mjs     41 passed
```
(No file under `packages/` or the app's TypeScript changed in this wave; the root gates of wave 2 stand.)

## Acceptance criteria
All five met.

## Follow-ups / TODO(verify)
- Not verified on a real keychain (fake, memory and sleeping stores only) and not through the app's webview `engine_command` with a blocked store (the equivalent `Request::Engine` through the owner loop was tested).
- A job still waiting after the 30 s drain at quit is dropped; its secret could stay in the store with no entry (documented in `deferred.rs`).
- If the store step of an update partly succeeds (the password set, then the link fails) the first item stays set; as before.
- The page does not read `result.notices` of a remove yet: task-006 now words `secret_not_removed`.
