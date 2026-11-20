# Task 003 — App: switching to another daemon entry — Summary

**Sprint:** sprint-109-desktop-registry-wiring · **Completed:** 2026-11-20 · **Status:** done

## What was implemented
- **Decision (pure):** `page::switch_decision(known, transfers) -> SwitchDecision { NotFound, Switch, Ask(text) }` sits beside `close_decision`. The text is "N file transfer(s) are still running. Switch anyway?".
- **One switch path:** `shell::switch::switch_to(services, access, transfers, id, reload) -> Result<Switched{Done,Cancelled}, String>`. It runs in this order:
  1. It reads `daemon.list` and returns `not_found` for an unknown id, with no question and no change.
  2. When transfers are running it shows the confirm. "No" returns `Cancelled`.
  3. It runs `daemon.switch`, which flushes the entry being left, records `lastUsedId` and writes the registry.
  4. It reloads the page.
- **`OwnerAccess` additions:** `call(Request)` and `execute(command, params)`, the latter through the `engine.execute` control path.
- **App wrapper:** `daemons::switch_window(handle, window, id)` gathers the managed `Bridge`, `Transfers` and `Services` and calls `switch_to` with `window.reload()`. The menu in task-004 can call it directly. It returns `Some("cancelled")` or `None`.
- **Page command:** `daemon_switch { id }` runs the wrapper off the session thread. It answers `"cancelled"`, an error, or null on success. It is registered in `build.rs`, `capabilities/default.json` (the only capability added), `generate_handler!` and the capability-list test.
- The docs in `commands.rs` and the capability file now say fifteen commands.

## Files
- `crates/shell/src/page.rs`
- `crates/shell/src/switch.rs` (new)
- `crates/shell/src/owner_access.rs`
- `crates/shell/src/lib.rs`
- `src-tauri/src/commands.rs`
- `src-tauri/src/daemons.rs`
- `src-tauri/src/main.rs`
- `src-tauri/build.rs`
- `src-tauri/capabilities/default.json`
- `src-tauri/src/commands/tests.rs`

## Build & test results
`cargo xtask ci` passes all 8 steps. The new tests are:
- **Decision:** `page.rs` tests the decision function.
- **Fake confirm:** `switch.rs` tests unknown id, "no", "yes", count 0 with no question, and a failed reload.
- **Real owner thread and tempdir:** `switch.rs` checks `daemons.json` `lastUsedId`, `daemon-state/local.json` holding the old layout, and `boot` returning the new entry's keys.
- **Page level:** `commands/tests.rs` tests `daemon_switch` through the page. The first test covers "cancelled" leaving the count and current entry alone, and `not_found` with no question. The second covers a confirmed switch writing the registry and local state, then booting on the new entry.

## Acceptance criteria
All met, including `daemon_switch` being the only capability added. The mock runtime's `reload()` returned `Ok`. A real reload is observed only in task-006, as the plan says.

## Follow-ups / TODO(verify)
- Task-006 must confirm that a real webview reload boots on the new entry.
- Switching to the entry that is already current is left to the caller.

## Proposed doc edits
- **`desktop/AGENTS.md` or native-host spec:** add "`daemon_switch { id }` (page) and `daemons::switch_window` (menu) both use `shell::switch::switch_to`: `not_found` → optional transfers confirm → `daemon.switch` → page reload; the page command answers `cancelled` or an error, nothing on success."
- **Command count:** change "fourteen page commands" to fifteen.
- **`desktop-daemon-registry.md` § Switching:** record the order not_found → confirm → switch → reload.

## Wave gate (orchestrator)
```
Agent-run cargo xtask ci (8 steps) passed; real reload observed in task-006.
```
