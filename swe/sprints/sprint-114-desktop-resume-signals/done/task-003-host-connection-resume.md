# Task 003 — Desktop host: a `connection` member whose `onResume` also hears the app

- **Sprint:** sprint-114-desktop-resume-signals
- **Status:** done
- **Type:** feature
- **Area:** desktop/apps/pistudiodesktop/src/host
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** none

## Goal
The desktop host has its own `connection` member: the browser host's transport and timers, and an `onResume` that fires for the browser's triggers and for the app's event.

## Context / why
This is the member sprint 116 gives a bridged transport. Building it now makes the resume signals useful whatever the benchmark says.

## Scope references
- `swe/features/desktop-transport-bridge.md` § 4 (`onResume`, `timers`), decision P7
- `packages/workbench/src/host/types.ts` (`HostConnection`), `browser-connection.ts`
- `desktop/apps/pistudiodesktop/src/host/desktop-host.ts`, `ipc.ts` (`IpcEvents.listen`)

## What to build
- A new module that builds the desktop `connection` from the browser host's: `createTransport` and `timers` passed through; `onResume(listener)` subscribes the listener to the browser host's triggers and to the `connection_resume` event, and returns one function that removes both.
- A listener that throws does not stop the others; a payload that is not the expected shape still counts as a signal.
- `createDesktopHost` uses it.

## Out of scope
- The bridged transport (sprint 116).
- Any change in `packages/workbench`.

## Acceptance criteria
- [ ] With a fake event source: the listener is called for an app event and for a browser trigger; after unsubscribing it is called for neither.
- [ ] Unsubscribing before the event registration resolved still ends with no listener registered.
- [ ] The app's `npm run check`, `npm run lint` and `npm test` pass.

## Test / verification plan
- `(cd desktop/apps/pistudiodesktop && npm run check && npm run lint && npm test)`

## Notes
- `ipc.ts` stays the only module that imports `@tauri-apps/api`.
