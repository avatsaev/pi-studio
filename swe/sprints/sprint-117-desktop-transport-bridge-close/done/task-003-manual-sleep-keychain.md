# Task 003 — A person: sleep and wake on real machines, and the keychain on macOS and Windows

- **Sprint:** sprint-117-desktop-transport-bridge-close
- **Status:** done (waived by the owner, 2026-11-22)
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
- [x] The results table has a row per machine with the recovery time and the keychain observations. Partly: a macOS arm64 row (a sleep failed, then passed with the reconnect fix `e1ebf23`); the other machines and items were waived by the owner.
- [ ] The spec's last Resume criterion is ticked, or the failure is described. Not ticked: shown on macOS arm64 only; the owner accepts the other machines as working without a run.

## Test / verification plan
- Follow `desktop/docs/platform-checks.md`.

## Notes
- Block this task with a Blocker note if nobody with the machines is available; it does not hold the other tasks.

## Blocker
Needs a person with a Linux, a Mac and a Windows machine: a real five-minute sleep and wake with a session open, the keychain items in Keychain Access and Credential Manager, what an unsigned macOS build asks after an update, a firewall or security-software prompt, and the `bufferedAmount` pause of an upload (steps M1 to M6 of the milestone 2 section of `desktop/docs/platform-checks.md`, which has an empty results row per machine). Blocked on 2026-11-22 when sprint 117 was run; nothing else in the plan waits for it. Unblock when the owner has run the checklist and put the results in the table.

## Resolution (2026-11-22)
The owner ran M1 on a MacBook (M3 Pro). The first build failed: after the wake the terminal took no input and the chat missed what ran meanwhile, a workbench defect fixed in `e1ebf23` (`packages/workbench/AGENTS.md`, "A reconnect keeps the client object"). The build of run 45008686113 passed. The owner then waived the rest: M1 on Windows, macOS x64, a Linux desktop and with a relay entry, and M2 to M6 (keychain after an update, firewall prompts, the `bufferedAmount` pause on Windows) are not run and are accepted as working for now. They stay as open rows in `desktop/docs/platform-checks.md`.
