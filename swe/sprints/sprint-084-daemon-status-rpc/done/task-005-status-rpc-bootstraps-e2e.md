# Task 005 — Handlers in both bootstraps, session-close disposal, dev-daemon E2E

- **Sprint:** sprint-084-daemon-status-rpc
- **Status:** done
- **Type:** feature
- **Area:** packages/server (observability, daemon)
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** task-004

## Goal

The status family works over a real socket on both daemons. It is registered but not yet
advertised (the flag lands in s085/t005).

## Scope references

- swe/features/daemon-status-rpc.md § New/changed files, § Acceptance criteria (status shape,
  clients incl. self, subscribe, unsubscribe/disconnect, authenticated only)
- packages/server/src/daemon/bootstrap.ts:743 (`onSessionClose` → `subscriptions.disposeSession`)
- packages/server/src/daemon/dev-bootstrap.ts:150-188 (registration block)
- packages/server/src/test-support/daemon-test-client.ts (s083/t002)

## What to build

- `observability/daemon-status-rpc.ts`: `registerDaemonStatusHandlers(registry, {service})` for
  the three requests. Domain failures go in the payload.
- Both bootstraps:
  - construct the service at the same point, early in the bootstrap (spec TODO on baseline
    alignment);
  - register the handlers;
  - compose `onSessionClose` to call `service.disposeSession`.
- `packages/server/src/daemon/daemon-status-e2e.test.ts` on the dev daemon with two clients (one
  with `appVersion:"pistudiodashboard/0.1.0"`):
  - shape: `version === SERVER_VERSION`, `pid`, `nodeVersion`, `memory.rss > 0`;
  - `agentsByStatus` after creating mock agents, with an archived one excluded;
  - `clients` has both entries, including the requester, ordered, each with `appVersion`,
    `transport` and `remoteAddress`;
  - subscribe pushes, unsubscribe stops, and a closed socket stops pushes.
- Auth: a password-protected `createWebSocketServer` test proves an unauthenticated socket cannot
  reach `daemon_status_request` and an authenticated one can.

## Acceptance criteria

- [ ] The E2E criteria above pass, with a short `intervalMs` injected in tests or fake timers
  (no 5 s real waits).
- [ ] `server_info.features` is unchanged (no `daemonObservability` yet).
- [ ] Existing daemon tests pass.

## Test / verification plan

- `npx vitest run packages/server/src/daemon packages/server/src/observability`; `npm run build:server`
