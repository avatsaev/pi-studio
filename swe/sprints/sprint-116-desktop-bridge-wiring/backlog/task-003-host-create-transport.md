# Task 003 — Desktop host: `createTransport` picks the proxy for local and direct entries

- **Sprint:** sprint-116-desktop-bridge-wiring
- **Status:** backlog
- **Type:** feature
- **Area:** desktop/apps/pistudiodesktop/src/host
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** task-001, sprint-115/task-004, sprint-114/task-003

## Goal
The window connects to a local or direct entry through Rust, and to a relay entry as before.

## Context / why
T1. The choice follows the kind of the current entry, not the shape of the target: a relay entry whose pairing link carries a direct host hint still stays on the webview's socket to the outside.

## Scope references
- `swe/features/desktop-transport-bridge.md` § 4 (`createTransport`), decisions T1, T5
- `desktop/apps/pistudiodesktop/src/host/` (the `connection` module of sprint-114/task-003, the proxied transport of sprint-115/task-004, `daemons.ts` for the current entry)
- `packages/workbench/src/lib/connection/connection-store.ts` (the one caller)

## What to build
- `createTransport(target, options)`: when the current entry is `local` or `direct`, the proxied transport; when it is `relay`, or there is no current entry, what the browser host returns.
- `options.password` is ignored for a proxied entry.
- Outside Tauri (the snapshot tool, a dev-server browser) the plain browser host is used, as today.

## Out of scope
- Any change under `packages/`.
- The password in `daemon_resolve_current` (task-004).

## Acceptance criteria
- [ ] With fakes: a direct and a local current entry get the proxied transport; a relay entry gets the browser host's; a relay entry with a direct host hint gets the browser host's.
- [ ] A password passed for a proxied entry is not sent to any command.
- [ ] The app's `npm run check`, `npm run lint` and `npm test` pass; `npm run snapshot` still draws the page with no Content-Security-Policy violation.
- [ ] In the container the window connects to a scratch daemon, `ui.inspect` shows one open transport, and the daemon's status shows one client.

## Test / verification plan
- `(cd desktop/apps/pistudiodesktop && npm run check && npm run lint && npm test && npm run snapshot)`
- `cargo xtask ci` in `desktop/`

## Notes
- The Content-Security-Policy is not changed: `ws:` already allows `ws://127.0.0.1:<port>`, and relay entries still need `ws:` and `wss:`.
