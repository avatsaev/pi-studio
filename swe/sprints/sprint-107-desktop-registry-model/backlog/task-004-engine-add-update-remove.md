# Task 004 — Engine: `daemon.add`, `daemon.update`, `daemon.remove`

- **Sprint:** sprint-107-desktop-registry-model
- **Status:** backlog
- **Type:** feature
- **Area:** desktop/crates/engine
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** task-003

## Goal
Entries can be added, edited and removed through engine commands, each change is on disk before the command answers, and removing an entry removes everything stored for it.

## Scope references
- `swe/features/desktop-daemon-registry.md` § Public contract 2 (`daemon.add`, `daemon.update`, `daemon.remove`), § Adding, editing, removing, § Data & persistence touchpoints
- `swe/grills/desktop-native-shell.md` D22, D23, D24
- `desktop/crates/engine/src/daemon_cmds.rs`, `session.rs` (task-003); `desktop/crates/model` (the operations and their error codes: task-001)

## What to build
| Command | Params | Result | Errors |
|---|---|---|---|
| `daemon.add` | `{ kind: "direct", name, address, password? }` or `{ kind: "relay", name, pairingLink }` | `EntryView` | `invalid_name`, `name_taken`, `invalid_address`, `invalid_link`, `too_many` |
| `daemon.update` | `{ id, name?, address?, password?: string or null, pairingLink? }`: `password: null` clears it, an absent field is unchanged | `EntryView` | the same, plus `not_found`, `wrong_kind` |
| `daemon.remove` | `{ id }` | `{ removed: true }` | `not_found`, `local_not_removable` |

- A new entry gets a fresh UUID. It is not made current.
- Every successful command writes the registry (private file) before it answers; a refused command writes nothing.
- `daemon.update` on `local` may change its name and password only.
- `daemon.remove` also deletes the entry's stored-state file (`daemon-state/<id>.json`); a missing file is not an error. When the removed entry was current, `lastUsedId` becomes null and the session's entry keys are emptied; the current entry reads as "none" until a switch.
- With no current entry, `daemon.list` answers `currentId: null` and a write of an entry-scoped key is dropped with a log line that names the key only.
- If the registry cannot be written, the command fails and the in-memory registry is left as it was.

## Out of scope
- Parsing an address or a pairing link (the workbench does, before it calls).
- What the window does after a removal (sprint-110/task-005).

## Acceptance criteria
- [ ] `daemon.add` of a direct entry with a password returns a view with `hasPassword: true`, and the file on disk holds the password.
- [ ] `daemon.update` with `password: null` clears it; with no `password` field it is kept; with a new pairing link on a relay entry the name and id are kept.
- [ ] Each error of the table is produced by a test, and after each the file's bytes are unchanged.
- [ ] `daemon.remove` deletes the entry and `daemon-state/<id>.json`; nothing with that id or its secret remains in the configuration directory.
- [ ] After removing the current entry, `daemon.list` has `currentId: null`, and after a restart the session opens on `local`.
- [ ] `daemon.remove` of `local` answers `local_not_removable`.
- [ ] A write failure (read-only directory) fails the command and `daemon.list` still shows the old registry.
- [ ] The adversarial command test passes.

## Test / verification plan
- `cargo test -p pistudiodesktop-engine --lib --tests`
- `cargo test -p pistudiodesktop-engine --test panic_hunt -- --ignored`
- `cargo clippy -p pistudiodesktop-engine --all-targets -- -D warnings`

## Notes
- `currentId: null` only arises by removing the current entry. A restart never opens on "none": launch falls back to `local`.
- The files set aside as corrupt (`*.corrupt-*`) may hold old secrets; they are kept on purpose (the user's data) and listed in the documents by sprint-111/task-003.
