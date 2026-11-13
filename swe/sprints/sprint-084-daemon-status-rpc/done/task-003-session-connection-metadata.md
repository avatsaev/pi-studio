# Task 003 — `Session` connection metadata; relay replacement disposes subscriptions

- **Sprint:** sprint-084-daemon-status-rpc
- **Status:** done
- **Type:** feature
- **Area:** packages/server (ws, daemon/bootstrap)
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** none

## Goal

Every live `Session` knows when it connected, the hello's `appVersion`, its peer address (direct
only) and its transport. A replaced relay session releases its per-session subscriptions.

## Context / why

`Session` (`ws/session.ts:10-25`) holds only `id, clientId, clientType, capabilities, socket`;
both handshakes drop `hello.appVersion`. `ws-server.ts:136` constructs direct sessions with `req`
in scope. `bootstrap.ts:807` constructs the relay session. `resetRelaySession` (`:777-778`) only
deletes from `relaySessions` and never calls `onSessionClose`, so `SessionSubscriptions` entries
(checkout status, file watch, and soon status/log subscribers) may leak (spec TODO(verify)).

## Scope references

- swe/features/daemon-status-rpc.md § Session metadata, § Error handling (relay replaced),
  § TODO(verify) (relay close path; `Session` defaults)
- packages/server/src/ws/session.ts, ws/ws-server.ts:136, ws/session-subscriptions.ts:53
  (`disposeSession`)
- packages/server/src/daemon/bootstrap.ts:273-276, :743, :777-884

## What to build

- `Session` read-only fields `connectedAt: number`, `appVersion?: string`,
  `remoteAddress?: string`, `transport: "direct" | "relay"`. They are optional constructor options
  with defaults (`Date.now()`, `"direct"`), so existing tests are unaffected.
- `ws-server.ts` passes `appVersion` and `req.socket.remoteAddress`. The relay handshake passes
  `appVersion` and `transport:"relay"`.
- The relay replacement and close paths run the same disposal as a direct close
  (`subscriptions.disposeSession`). Do this only if verification confirms the leak; otherwise
  record why not.
- `appVersion` is **not** written to the capability store.

## Acceptance criteria

- [ ] A hello with `appVersion` yields `session.appVersion` equal to it, and one without yields
  `undefined`. The direct session has `transport:"direct"` and a `remoteAddress`.
- [ ] A relay session has `transport:"relay"` and no `remoteAddress` (relay handshake unit test, or
  the existing relay bootstrap test).
- [ ] Replacing the relay session disposes its subscriptions (regression test, if the leak is
  confirmed).
- [ ] The capability store contents are unchanged by `appVersion`.

## Test / verification plan

- `npx vitest run packages/server/src/ws packages/server/src/daemon`; `npm run build:server`
