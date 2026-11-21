# Task 004 — Linux live check: stop and continue, and an address change

- **Sprint:** sprint-114-desktop-resume-signals
- **Status:** done
- **Type:** test
- **Area:** desktop/docs
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** task-001, task-002, task-003

## Goal
In the real app on Linux, a simulated sleep and a network change each make the session recover without a reload.

## Context / why
A machine cannot be put to sleep in the container. Stopping the app's processes while the daemon restarts gives the same situation: time passed, and the socket is dead.

## Scope references
- `swe/features/desktop-transport-bridge.md` § Acceptance criteria (Resume), § After a wake
- `desktop/docs/development.md` (the container, WebKitWebDriver)

## What to build
- In the container, real webview, scratch daemon, the window connected:
- (1) stop every process of the app for 30 s, restart the daemon meanwhile, continue: `resumeSignals.wake` rises by one and the connection bar shows connected again within 10 s, with the page not reloaded (the count of `boot` calls in the log is unchanged);
- (2) add and remove an address on a dummy interface (the container needs `NET_ADMIN`): `resumeSignals.network` rises by one each time, and two changes within 5 s give one event;
- (3) with the daemon left running in (1), the connection stays open after the probe.
- `desktop/docs/development.md` gains the commands. A failed check is fixed in the task that owns the code.

## Out of scope
- A real sleep on a real machine (sprint 117, a person).
- The bridge: the socket is still the webview's here.

## Acceptance criteria
- [ ] The three runs are in the summary with commands and observed times.
- [ ] The spec's two automated Resume criteria are ticked with this evidence, noting that the socket was the webview's; they are run again with the bridge in sprint 117.
- [ ] `cargo xtask ci` passes.

## Test / verification plan
- `cargo xtask ci` in `desktop/`
- The live runs, with a scratch `PI_STUDIO_HOME`, a free port and `--secret-store file`.

## Notes
- If the container cannot change addresses, say so and leave (2) to the unit tests and to a real machine.
