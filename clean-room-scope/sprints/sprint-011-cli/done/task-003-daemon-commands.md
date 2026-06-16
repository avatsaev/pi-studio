# Task 003 — Daemon command group + local spawn + QR pairing

- **Sprint:** sprint-011-cli
- **Status:** done
- **Estimated size:** M
- **Depends on:** task-001; task-005 (sprint-004, bootstrap)

## Goal
Implement the `daemon` command group, including starting/supervising a local daemon and rendering a
QR pairing code.

## Scope references
- `clean-room-scope/features/cli.md` § Command tree (daemon), § Behavior, § Example invocations
- `clean-room-scope/architecture/daemon-bootstrap.md`, `clean-room-scope/architecture/relay-e2ee.md` § Pairing

## What to build
- `daemon` group: `start`, `stop`, `restart`, `status`, `pair`, `set-password`.
- Local daemon spawner: when no reachable daemon and the command needs one (`pi-studio` /
  `daemon start`), start a managed local daemon (`$PI_STUDIO_HOME=~/.pi-studio`, port 6767) and print a
  QR code / pairing link (the daemon public key in a URL fragment — see relay-e2ee pairing).
- `set-password` sets the bcrypt-hashed daemon password; `status` reports daemon health; `pair`
  renders the pairing QR/link for other clients.
- top-level `pi-studio` (no command) / `onboard` may start+connect and show the QR.

## Out of scope
- Relay transport internals (sprint-018). Other feature command groups (task-004).

## Acceptance criteria
- [ ] `pi-studio daemon start` starts a daemon and shows a pairing QR code.
- [ ] `daemon stop`/`restart`/`status` manage/report the local daemon.
- [ ] `set-password` stores a bcrypt-hashed password the daemon then enforces.
- [ ] When no daemon is reachable, `pi-studio` starts a local one (where appropriate) or errors with guidance.

## Test / verification plan
- Tests: `npx vitest run packages/cli/.../daemon-cmds.test.ts` — spawn lifecycle, status, set-password.
- Manual: `pi-studio daemon start` prints a scannable QR; `daemon stop` releases the PID lock.

## Notes
- Honor the operational rule: never restart the production daemon without explicit user intent. Relay
  pairing flow specifics (`daemon pair`) are TODO(verify).
