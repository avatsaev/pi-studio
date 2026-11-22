# Task 004 — Desktop host: the proxied `Transport` in TypeScript — Summary

- **Sprint:** sprint-115-desktop-bridge-core
- **Completed:** 2026-11-22
- **Status:** done

## What was built
`createProxiedTransport(ipc, createInner = createWebSocketTransport)` in `desktop/apps/pistudiodesktop/src/host/proxied-transport.ts`. `connect(url)` invokes `transport_open { url }`; a command error rejects with its message and leaves the inner transport untouched; a failed inner connect to the answered address rejects with the `local_connection` message (`LOCAL_CONNECTION_MESSAGE`, never holding the address or token); every other member is the inner transport's. The answered address is never logged, kept or put in an error. Not wired into `createTransport` (sprint 116).

## Files changed
New: `src/host/proxied-transport.ts`, `src/host/proxied-transport.test.ts` (5 tests). Edited: `desktop/apps/pistudiodesktop/package.json` and the root `package-lock.json` (one line each: dependency `@av-pi-studio/client: "*"`, the app had none; the root lock already resolved the workspace package).

## Commands run
- In `desktop/apps/pistudiodesktop`: `npm run check`, `npm run lint`, `npm test` passed (125 tests).

## Wave gate (orchestrator, combined tree)
- `cargo xtask ci` in `desktop/`: all 8 steps passed (fmt, web, clippy, layers, test, panic_hunt, doctest, wasm).
- Root `npm run build && npm run typecheck && npm run lint && npm test`: exit 0; 291 files, 4,133 tests passed.

## Acceptance criteria
- [x] A fake `Ipc` and inner transport: connect invokes `transport_open` and connects to the answered address; a command error rejects with its message.
- [x] A failed inner connect rejects with the `local_connection` message, which contains neither the address nor the token (it names `127.0.0.1` only as a generic hint, as the spec says).
- [x] Two connects make two `transport_open` calls; handlers set before and after `connect` both receive events.
- [x] A marker token appears in no `console` call and no thrown message.
- [x] The app's gates and the root gates pass (wave gate).

## Follow-ups / TODO(verify)
- `desktop/` is in the oxfmt ignore list (`.oxfmtrc.json`), which is why oxfmt reported no target for the new files; lint passes.
