# Task 003 — A person: sleep and wake on real machines, and the keychain on macOS and Windows

- **Sprint:** sprint-117-desktop-transport-bridge-close
- **Status:** backlog
- **Type:** test
- **Area:** desktop/docs
- **Priority:** P2
- **Estimated size:** S
- **Depends on:** task-001

## Goal
The feature's check is done on real hardware: the machine sleeps, wakes, and the session recovers without a reload.

## Context / why
No runner can sleep. The owner has a Linux, a Mac and a Windows machine. This task is expected to wait in `blocked/` until someone runs it.

## Scope references
- `swe/features/desktop-transport-bridge.md` § Purpose (the check), § Acceptance criteria (Resume, the last item), § TODO(verify) (macOS and an unsigned build)
- `desktop/docs/platform-checks.md` (the section task-001 adds)
- `.github/workflows/desktop-release.yml` (a manual run builds installers without releasing)

## What to build
- Installers from a manual run of the Desktop release workflow on the branch.
- On each machine: connect to a daemon, sleep for five minutes, wake, and note how long the session takes to recover and whether the page reloaded.
- On macOS and Windows: the keychain items of the checklist, and on macOS what the system asks after installing a newer build over an older one.
- **Added 2026-11-22 (the proxy design, T5):** on each machine, with the system's firewall on and whatever security software the machine has: note whether connecting to a direct entry shows a firewall or security prompt (the app listens on `127.0.0.1` for a moment at each connect), and whether the connection bar ever shows the `local_connection` message. On Windows also once after a fresh install.
- The results go into the checklist's results table.

## Out of scope
- Fixing what is found: a failure goes back to the task that owns the code.

## Acceptance criteria
- [ ] The results table has a row per machine with the recovery time and the keychain observations.
- [ ] The spec's last Resume criterion is ticked, or the failure is described.

## Test / verification plan
- Follow `desktop/docs/platform-checks.md`.

## Notes
- Block this task with a Blocker note if nobody with the machines is available; it does not hold the other tasks.
