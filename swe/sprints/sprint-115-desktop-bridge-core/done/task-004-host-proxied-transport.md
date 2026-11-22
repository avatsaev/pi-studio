# Task 004 — Desktop host: the proxied `Transport` in TypeScript

- **Sprint:** sprint-115-desktop-bridge-core
- **Status:** done
- **Type:** feature
- **Area:** desktop/apps/pistudiodesktop/src/host
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** sprint-112/task-008 (the design)

## Goal
A `Transport` for the SDK that asks Rust where to connect and then is the SDK's own WebSocket transport, pointed at the local address Rust answered.

## Context / why
Decision T5: the page keeps a WebSocket, to `127.0.0.1` only. So nothing of the SDK's transport is reimplemented: frames, order, `bufferedAmount` and close handling stay the SDK's. The only new behaviour is the step before the socket opens, and the error when that socket cannot open.

## Scope references
- `swe/features/desktop-transport-bridge.md` § 2 (`transport_open`), § 4 (the proxied `Transport` table), § Error handling (`local_connection`)
- `packages/client/src/transport.ts` (`Transport`, `createWebSocketTransport`), `reconnect.ts` (connect is called again on the same transport)
- `desktop/apps/pistudiodesktop/src/host/ipc.ts` (the only importer of `@tauri-apps/api`), `connection.ts`
- `desktop/apps/ipc-bench/page/transport.js` (`createProxyTransport`: the measured sketch)

## What to build
- A function that makes the proxied transport from an `Ipc` and a factory for the inner transport (default: the SDK's `createWebSocketTransport()`), so tests pass fakes.
- `connect(url)`: invoke `transport_open` with `{ url }`; on a command error reject with an `Error` whose message is the error's `message`; then the inner transport's `connect(localUrl)`; if that rejects, reject with the `local_connection` message (the app could not open its own local connection; security software may be blocking `127.0.0.1`).
- Every other member is the inner transport's. `onMessage`, `onClose` and `onError` set by the SDK reach the inner transport.
- A second `connect` after a close asks Rust again: each call is a new `transport_open`.
- `localUrl` is passed to the inner transport and nowhere else: not logged, not kept after the connect, not part of any error message.

## Out of scope
- Choosing it in `createTransport` (sprint 116).
- Any change under `packages/`.
- The command itself (sprint 116/task-001).

## Acceptance criteria
- [ ] With a fake `Ipc` and a fake inner transport: connect invokes `transport_open` with the URL and connects the inner transport to the answered address; a command error rejects with its message and the inner transport is not touched.
- [ ] A failed inner connect rejects with the `local_connection` message, and that message does not contain the local address.
- [ ] Two connects make two invocations; handlers assigned before or after `connect` receive the inner transport's events.
- [ ] A marker token in `localUrl` appears in no log call and no thrown message.
- [ ] The app's `npm run check`, `npm run lint` and `npm test` pass.

## Test / verification plan
- `(cd desktop/apps/pistudiodesktop && npm run check && npm run lint && npm test)`

## Notes
- Hoist functions that capture nothing.
- The oxlint rule that bans network calls in this package stays on: the socket is built by the SDK, not here.
