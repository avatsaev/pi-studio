# Task 002 — Capability flags + compatibility gating

- **Sprint:** sprint-002-protocol
- **Status:** done
- **Estimated size:** XS
- **Depends on:** task-001

## Goal
Define `CLIENT_CAPS` (client→daemon) and `server_info.features.*` (daemon→client) constants and the
serialization-time gating contract.

## Scope references
- `clean-room-scope/architecture/websocket-protocol.md` § Capability flags, § Compatibility rules
- `clean-room-scope/MAIN-SCOPE.md` § 9 (Feature compatibility)

## What to build
- Create `packages/protocol/src/client-capabilities.ts` with `CLIENT_CAPS` constants
  (e.g. `custom_mode_icons`, `reasoning_merge_enum`, `terminal_reflowable_snapshot`).
- Define `server_info.features.*` flag keys (e.g. `providersSnapshot`,
  `checkoutGithubSetAutoMerge`, `daemonStatusRpc`, `terminal-restore-modes`, `rewind`,
  `checkoutRefresh`), each with a `COMPAT(name)` comment (version added + removal date placeholder).
- Provide a `supports(caps, flag)` helper modeling `session.supports(...)`.

## Out of scope
- Wiring `supports()` into the daemon session (sprint-004).

## Acceptance criteria
- [ ] `CLIENT_CAPS` and `features` flag sets are exported and typed.
- [ ] `supports(caps, flag)` returns true only for advertised flags.
- [ ] Each feature flag carries a `COMPAT(...)` annotation.

## Test / verification plan
- Tests: `npx vitest run .../capabilities.test.ts` — `supports` true/false matrix.

## Notes
- New wire enum values must be gated through `supports(...)` so old clients never receive values they
  didn't advertise. Floor versions are TODO(verify) against the live `ServerInfoStatusPayloadSchema`.
