# Task 001 — Settings: `shareUsageData` and `usageId`

- **Sprint:** sprints/sprint-157-desktop-usage-data
- **Status:** done
- **Type:** feature
- **Area:** desktop/crates/model, desktop/crates/engine
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** none

## Goal
`settings.json` carries the switch (`shareUsageData`, absent reads `true`) and the stored ID
(`usageId`); `settings.set` changes the switch and refuses the ID.

## Context / why
Spec § 3, U4, U5, D4, D9. The shell (task-002) reads both and writes the ID through a store method;
no command may set it.

## Scope references
- `swe/features/desktop-usage-data.md` § 3, U4, U5, U6
- `desktop/crates/model/src/lib.rs` (`Settings`, `Settings::set`, `Default`)
- `desktop/crates/engine/src/settings_cmds.rs` (`specs`, `current`, tests)
- `desktop/crates/engine/src/storage.rs` (`set_setting` and its roll-back; a new writer for the ID)

## What to build
- `Settings`: `share_usage_data: bool` (`#[serde(default = "default_true")]`, camelCase
  `shareUsageData`), `usage_id: Option<String>` (`usageId`, omitted when `None`).
  `set("shareUsageData", bool)`; `set("usageId", …)` is `UnknownKey` like `cliPath`.
- `settings.get` answers `{autoStartLocalDaemon, checkForUpdates, shareUsageData}`; never `usageId`.
  The params text of `settings.set` lists the new key.
- `storage.rs`: the roll-back of `set_setting` covers `share_usage_data`. A crate-visible method that
  stores a given ID and writes `settings.json` before returning, rolling back on a failed write (the
  same rule as `set_setting`); the shell uses it in task-002.
- A pure helper (model) `is_usage_id(&str) -> bool`: lower-case hyphenated UUID version 4 (U5).

## Out of scope
Making the ID (task-002), the panel (task-003).

## Acceptance criteria
- [x] Absent `shareUsageData` reads `true`; `false` round-trips; a non-boolean is refused and nothing changes.
- [x] `settings.set` with `usageId` is refused; `settings.get` never contains it.
- [x] A stored ID survives a decode/encode round trip; an unknown older file still loads.
- [x] A failed write rolls back both the switch and a newly stored ID.
- [x] `is_usage_id` accepts a v4 UUID and refuses upper case, v1/v7, wrong length, empty.

## Test / verification plan
- `cd desktop && cargo test -p pistudiodesktop-model -p pistudiodesktop-engine`
- Existing tests asserting the exact `settings.get` answer are updated (they pin the contract).

## Notes
`desktop/crates/model/src/lib.rs` tests `set_setting` and `cli_path_is_no_setting` pin the answer
shape; extend, do not weaken.
