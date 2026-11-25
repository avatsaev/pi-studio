# Task 002 — Shell: the usage state, the event, the view, `boot` and `ui.inspect`

- **Sprint:** sprints/sprint-157-desktop-usage-data
- **Status:** done
- **Type:** feature
- **Area:** desktop/crates/shell
- **Priority:** P1
- **Estimated size:** M
- **Depends on:** task-001

## Goal
All usage decisions live in a Tauri-free, socket-free module of the shell: why a run is blocked,
when an event is due, the event's JSON body, the ID's creation, and the `UsageView` in `boot` and
`ui.inspect`. Sending goes through a `Services` hook.

## Context / why
Spec § 2, § 4, § 5, § Behavior, U5–U10, P4, P7–P11. Rule 4 of `desktop/AGENTS.md`: nothing below the
app binary uses Tauri or opens sockets, so the HTTP request is the app binary's (task-004).

## Scope references
- `swe/features/desktop-usage-data.md` § 2, § 4, § 5, § 8, § Behavior & algorithms
- Create `desktop/crates/shell/src/usage.rs` (+ tests); modify `lib.rs`, `services.rs` (a new hook),
  `page.rs` (`boot`'s `usage` part and its doc comment), `control.rs` (`ui.inspect`'s `usage` part)
- `desktop/crates/shell/src/update.rs` (`InstallKind::as_str`), `desktop/crates/model/src/registry.rs` (`Kind`)

## What to build
- `Blocked` = `Build | DoNotTrack | Ci | Scripted`, computed once by a pure function from inputs
  `{has_token, test_build, do_not_track: Option<String>, ci: Option<String>, scripted: bool}` with
  § 4's order and value rules (`DO_NOT_TRACK` off only when unset, empty or `0`; `CI` off when unset,
  empty, `false` or `0`); U3 drops `Ci` and `Scripted` in a test build.
- `UsageRun` (per process): blocked, session UUID, start time, last attempt, closed-sent flag.
  `sending(settings)`, `due_daily(now)` (U9), `take_closed()` (once only, U10).
- `Event` builder: name, ID, session, timestamp, properties from given inputs (os, arch, version,
  install kind, locale, the four registry counts, `duration_s` for `app_closed`) → § 2's body and
  headers' values (RFC 3339 UTC with milliseconds; a new UUID per event and per request). UUID v4 from
  `getrandom`; no new crate unless `uuid`/`time` (already in `Cargo.lock`, MIT/Apache) are cleaner.
- ID: before a send, the stored ID if `is_usage_id`, else a new one stored through task-001's writer;
  a failed write means no send (U6).
- `Services`: an optional `usage` hook taking a ready request (endpoint is the binary's) and a time
  limit, returning success or a short failure code. Absent hook ⇒ treated as `Build`.
- `UsageView` serialised as § 4: `boot` includes `id` when one exists; `ui.inspect` never does.
- Entry points the binary calls: `on_launch`, `on_tick` (hourly and wake), `on_close` (exit or update
  restart; returns the request to send blocking with 2 s, or nothing).

## Out of scope
The HTTP client, timers, `RunEvent` wiring, locale reading (task-004).

## Acceptance criteria
- [x] `Blocked` for every combination of the inputs, including U3 and the value rules.
- [x] U9 with a fake clock: launch, 23 h, 24 h, after a failed attempt, a wake after days, switched on
  mid-run (no attempt yet ⇒ due), switched off mid-run (nothing).
- [x] `on_close` yields one request across exit and update restart, only when sending, with the right
  `duration_s`; switched off ⇒ none.
- [x] The body has exactly § 2's fields and properties; with registry entries whose names and
  addresses are marker strings, the serialised body contains none of them; `locale` absent when `None`.
- [x] No ID is made while blocked or switched off; the first send stores one; a failed store sends nothing.
- [x] `ui.inspect.usage` has no `id`; `boot.usage` has it once made.

## Test / verification plan
- `cd desktop && cargo test -p pistudiodesktop-shell`
- `cd desktop && cargo xtask layers` (no Tauri, no socket crate in `shell`)

## Notes
Logging codes (P10) are produced by the binary; this module only returns them.
