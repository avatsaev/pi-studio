# Task 003 — Desktop host: every kind proxied, the relay reason rethrown, the engine for relay, the CSP

- **Sprint:** sprint-126-desktop-relay-wiring
- **Status:** backlog
- **Type:** feature
- **Area:** desktop/apps/pistudiodesktop/src/host, src-tauri/tauri.conf.json, packages/workbench (connect-current if needed)
- **Priority:** P1
- **Estimated size:** M
- **Depends on:** task-001

## Goal
The page never opens a relay socket itself; relay failures still reach the workbench as `RelayConnectError`; relay transfers use the engine; the CSP allows only the loopback WebSocket.

## Context / why
D4, D5, D6, S14. `connect-current.ts` skips the password for a pairing URL; after S3 the URL is a plain address.

## Scope references
- `swe/features/desktop-relay-ssh.md` § 9, D4, D6, S14, § TODO(verify) (the page's other sockets, the stored URL)
- `desktop/apps/pistudiodesktop/src/host/connection.ts`, `proxied-transport.ts`, `transfers.ts`, `desktop-host.test.ts`
- `packages/workbench/src/features/daemons/connect-current.ts`, `daemon-lifecycle.ts`, `lib/connection/connect-failure.ts`
- `desktop/apps/pistudiodesktop/src-tauri/tauri.conf.json`

## What to build
- `createTransport` returns the proxied transport for every kind; the relay path is removed.
- The proxied transport rejects with `RelayConnectError(reason)` when the code is one of the SDK's relay reasons and the current entry is `relay`.
- `files` use the engine for relay entries.
- `connect-src`: `ws://127.0.0.1:*` and the IPC origins, no `ws:`/`wss:` wildcard; resolve the TODO about other sockets first.

## Out of scope


## Acceptance criteria
- [ ] Host tests: the kind matrix proxies all kinds; a `wrong_key` rejection is a `RelayConnectError`; the engine is chosen for relay.
- [ ] `npm run snapshot` passes under the new CSP.

## Test / verification plan
- `cd desktop/apps/pistudiodesktop && npm run check && npm test && npm run snapshot`
- `npx vitest run packages/workbench/src/features/daemons`

## Notes

