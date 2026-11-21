# Task 006 — App and CLI binaries: backend choice at launch, `--secret-store`, `secretStore` in the views

- **Sprint:** sprint-113-desktop-secret-store
- **Status:** in_progress
- **Type:** feature
- **Area:** desktop/apps/pistudiodesktop/src-tauri, desktop/apps/pistudiodesktop-cli, desktop/crates/shell
- **Priority:** P1
- **Estimated size:** M
- **Depends on:** task-002, task-005

## Goal
The app picks the keychain when it can be used and the file otherwise, says which in its views, and automated runs can force the file.

## Context / why
P4. Automated checks and live checks run with scratch configuration directories and must never write to a developer's keychain.

## Scope references
- `swe/features/desktop-transport-bridge.md` § 5 (backend choice, `--secret-store`), § 7 (`connection.secretStore`), § 4 (the registry view)
- `desktop/apps/pistudiodesktop/src-tauri/src/main.rs` (options), `daemons.rs`, `commands.rs` (`boot`)
- `desktop/apps/pistudiodesktop-cli/src/main.rs`
- `desktop/crates/shell/src/control.rs` (`view`), `page.rs`
- `desktop/apps/pistudiodesktop/scripts/platform-checks/*.mjs`, `desktop/docs/development.md`, `desktop/docs/control-protocol.md`

## What to build
- Launch option `--secret-store keychain|file` on the app and on the app's CLI. Without it: probe the keychain (off the main thread, at most 2 s); use it when it answers, else the file backend. **Added at wave 2 (2026-11-21, from s113/t002):** `KeychainStore::probe` only reads a missing item, so a Secret Service whose default collection is locked or absent passes it and the first `set` then fails with `Denied`. The launch check therefore also writes and deletes a throwaway probe item through the store (within the same 2 s); a `Denied` or `Unavailable` there means the file backend, with a notice that says why. Never leave the probe item behind.
- The chosen kind is `secretStore` in the registry view that `boot` returns and that `daemons_changed` carries, and in `ui.inspect` as `connection: { secretStore }` (the object the later sprints add fields to).
- The platform-checks script and every command line in `desktop/docs/development.md` pass `--secret-store file`.
- The secret guard test covers the new answers.
- **Added at wave 2 (2026-11-21, from s113/t004's summary):** (1) The app binary still passes the memory backend to the session (the configuration directory is known only after the Tauri builder runs), so a real version 1 `daemons.json` would lose its secrets at exit. This task gives the app the real store choice **before** the session opens a real configuration directory; nothing is released between s113/t004 and this task. (2) Turn `Opened.reset` of the `FileStore` into a notice (`Notice::FileReset` fits; `boot.ts` needs `keptAs` as a string, so decide how a missing name is worded). (3) The workbench's `DaemonErrorCode` (`packages/workbench`) and `CODES` in `desktop/apps/pistudiodesktop/src/host/daemons.ts` lack `secret_missing`, `secret_unavailable` and `secret_store_failed`: add them with their messages, so the page shows words instead of a code. (4) The documents list the page-visible `secrets_not_moved` notice and those three codes.
- `desktop/docs/control-protocol.md` documents the new field.

## Out of scope
- The Daemons screen's line (task-007).
- Checks of the real keychain on macOS and Windows (sprint 117).

## Acceptance criteria
- [ ] `--secret-store file` gives `secretStore: "file"` and a `secrets.json` once a secret is saved; `keychain` on a machine without one fails the launch with a message that names the option.
- [ ] With no option and no Secret Service the app starts with `file`; with one it starts with `keychain`.
- [ ] `boot`, `daemons_changed` and `ui.inspect` show the kind; none of them shows a secret.
- [ ] The page's command list and the capability are unchanged.
- [ ] `cargo xtask ci` passes; the script's unit tests pass.

## Test / verification plan
- `cargo test -p pistudiodesktop -p pistudiodesktop-shell`
- `(cd apps/pistudiodesktop && npm test)`
- `cargo xtask ci` in `desktop/`

## Notes
- The first keychain read on macOS may show a prompt. The window must still open: the probe and the reads never run on the main or the owner thread.
