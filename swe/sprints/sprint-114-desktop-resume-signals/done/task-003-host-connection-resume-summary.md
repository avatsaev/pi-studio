# Task 003 — Desktop host: a `connection` member whose `onResume` also hears the app — Summary

- **Sprint:** sprints/sprint-114-desktop-resume-signals
- **Completed:** 2026-11-21
- **Status:** done

## What was implemented
`createDesktopConnection(base, events, log)` in `desktop/apps/pistudiodesktop/src/host/connection.ts`: spreads the browser host's `connection` (so `createTransport` and `timers` pass through), and `onResume(listener)` subscribes the listener to the browser host's triggers and to the `connection_resume` event, returning one function that removes both. A throwing listener is caught and logged; the payload is never read (any payload counts); unsubscribing before `listen` resolved calls the late stop function at once. `desktop-host.ts` gets one wiring line. `connection.test.ts` has 4 tests with fake sources.

## Results
```
(cd desktop/apps/pistudiodesktop && npm run check && npm run lint && npm test)   clean; 102 passed at the time (111 with sibling tests)
```

## Wave gate (orchestrator, combined tree, 2026-11-21)
```
$ (cd desktop && cargo xtask ci)     all 8 steps passed (fmt, web, clippy, layers, test, panic_hunt, doctest, wasm)
$ npm run build && npm run typecheck && npm run lint && npm test
  build 0, typecheck 0, lint 0 (warnings only in files this work did not touch), 291 files, 4132 tests passed
```

## Acceptance criteria
All three met.

## Follow-ups / TODO(verify)
No dependency or document change. `ipc.ts` stays the only importer of `@tauri-apps/api`.
