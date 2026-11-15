# Task 006 — End to end: SDK ↔ real relay ↔ real daemon

- **Sprint:** sprint-100-relay-daemon-sdk
- **Status:** done
- **Type:** test
- **Area:** packages/cli (cross-package tests)
- **Priority:** P1
- **Estimated size:** M
- **Depends on:** task-005

## Goal
The feature's acceptance criteria that can run in the suite run against the real relay server, the production daemon and the SDK together.

## Context / why
Each package now tests its own half against the real relay, but no test drives `DaemonClient` through the relay into `startDaemon`. That is where multi-client, pacing and refusals become visible to a user. `packages/cli` is the only package that depends on client, server and relay together (the pattern of `file-transfer-sdk-e2e.test.ts`).

## Scope references
- `swe/features/relay-multi-client.md` § Acceptance criteria (two clients, 32 cap, transfer + second client, binary frames, offline/unresponsive/15 s, pairing link from before)
- Create: `packages/cli/src/relay-e2e.test.ts`
- Reference: `packages/cli/src/file-transfer-sdk-e2e.test.ts` (harness, sha256), `packages/cli/src/pairing.ts` (`buildPairingUrl`), `packages/client/src/pairing.ts` (`parsePairingUrl`), `packages/server/src/daemon/bootstrap.test.ts` (booting `startDaemon` with a temp home and relay config)

## What to build
A harness: `startRelayServer` on port 0 (short attach timer), `startDaemon` with a temp `PI_STUDIO_HOME` and `daemon.relay` pointing at it, the pairing URL built from the daemon's key file, and clients built from that URL: `parsePairingUrl` → `createRelayTransport` → `DaemonClient` with a `WsFactory` that records frame types. Cases:
- Two clients connected at once each answer an RPC; `daemon_status` lists two relay sessions; closing one leaves the other working.
- 32 connected, the 33rd rejects with `too_many_clients`; after one closes, a new one connects.
- Download and upload of a 64 MiB file through the relay with matching SHA-256 (600 MiB is sprint-101/task-001). A second client answers `list_agents_request` while the download runs.
- After pairing, every frame the client sends or receives is binary (the recording factory).
- Daemon stopped → the next connect rejects with `daemon_offline` in under 1 s.
- A pairing URL generated before restarting the daemon (same home, same key) still connects after the restart (D14).

## Out of scope
- The 600 MiB and memory proof (sprint-101/task-001). Browser and compose checks (sprint-101/task-003).

## Acceptance criteria
- [ ] All cases above pass, deterministically, in under 60 s total on a dev machine.
- [ ] The test cleans up its relay, daemon, temp home and files in `afterEach`, including on failure.

## Test / verification plan
- `npm run build:relay && npm run build:server && npm run build:client` (the cli tests import built packages)
- `npx vitest run packages/cli/src/relay-e2e.test.ts`
- `npx oxfmt <changed files>`

## Notes
- If 32 full SDK clients make the test slow, connect the first 31 at the relay level only (raw `relay_client_connect` sockets still count toward the cap) and use the SDK for the 32nd and 33rd.
- `daemon_unresponsive` and the 15 s `timeout` are already covered at SDK level (task-004). Do not repeat them here with real waits.
