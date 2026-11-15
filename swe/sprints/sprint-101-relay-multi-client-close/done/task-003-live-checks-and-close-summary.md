# Task 003 — Live checks and spec close — Summary

- **Sprint:** sprints/sprint-101-relay-multi-client-close
- **Completed:** 2026-11-15
- **Status:** done

## What was implemented
Live checks on an isolated compose stack (`docker compose -p relayproof`, scratch Pi home / dev dir / projects, ports 6967 / 7100 / 8180, torn down and images removed afterwards) plus native 0.0.120 checks (new relay build, 0.0.120 daemon installed from npm into a scratch dir). Both specs ticked with evidence, statuses set to built, TODO(verify) items updated, MAIN-SCOPE index and PLAN.md updated.

| Step | Result |
|---|---|
| 1. Two browser tabs on one pairing link, terminal + file transfer at once | Both tabs `connected`; `daemon_status` listed three relay sessions (two tabs + an SDK client). Tab A ran a terminal (4000-line loop, output complete) while tab B uploaded a 48 MB file through the Files panel; SHA-256 in the container matched the source; neither tab disconnected. |
| 2. Daemon container stopped, then started | After the fix below: the tab shows "The daemon is not connected to the rela…" with Retry; relay logs 4102 refusals every ~1–2 s; on daemon start both tabs reconnected on their own. |
| 3. Pairing link from before | The same link worked across daemon stop/start (same data volume, same key) and the relay restart. |
| 4. Relay restarted (12 s down) | Daemon log: control socket closed 1001 "going away", then redials after 1196 / 1896 / 4431 / 7441 ms (backoff with jitter), then registered; tabs reconnected. |
| 5a. 0.0.120 daemon against the new relay | Parked at once (`parked old-protocol socket`), stayed connected 8+ minutes: one `relay connected`, no redial, never closed with 4108 (it answers pings). A new SDK client got `daemon_outdated` in 8 ms. |
| 5b. 0.0.120 client against an updated daemon | The 0.0.120 SDK (not a 0.0.120 browser tab) was parked and never answered; stayed "connecting". |
| 5c. S9 | Updated daemon stopped, only the old client parked under its id: a new client got `daemon_offline`, not `daemon_outdated`. |

## Defects found by the live check (both fixed, regression-tested)
1. **A transport could not reconnect.** `createRelayTransport` rejected a second `connect()` ("single-use", chosen in s100/t004), but `DaemonClient` reconnects by calling `connect()` on the same transport, so after any daemon or relay drop the tab could never come back. Now each `connect()` is a new attempt (generation counter; stale events of an older attempt are ignored); a second `connect()` while connecting/open still rejects.
2. **A refused connect left the client in `connecting` forever.** `fail()` rejected the promise but never called `onClose`; `DaemonClient.connect()` sets `connecting` and only `onClose` moves it to `closed`. The tab therefore showed "Connecting…" indefinitely, never the refusal message and never retried. `fail()` now calls `onClose(1006, message)` after rejecting, like a failed direct WebSocket.
Tests: `relay-transport.test.ts` (reconnect after daemon close; retry after refusal; second connect rejected; onClose once after a refusal) and `relay-e2e.test.ts` (refused `DaemonClient` is `closed`, then connects on the same object after the daemon returns). The first two were verified to fail against the old guard. `packages/client/AGENTS.md` updated.

## Files changed
`packages/client/src/relay-transport.ts` + `.test.ts`, `packages/cli/src/relay-e2e.test.ts`, `packages/client/AGENTS.md`, `swe/features/relay-multi-client.md`, `swe/architecture/relay-protocol.md`, `swe/MAIN-SCOPE.md`, `swe/sprints/PLAN.md`.

## Build & test results (final gate, orchestrator)
```
$ npm run build && npm run typecheck -> success
$ npm run lint -> no errors (pre-existing warnings only)
$ oxfmt --check on every changed ts/tsx/json file -> clean
$ npm test -> 274 files, 3897 passed
```
(One run failed `bootstrap.test.ts` "extension packs RPC" because exported live-check variables (`PI_STUDIO_PI_HOME` → deleted scratch dir) had leaked into the shell; after `unset` the suite is green. Not a code defect.)

## Acceptance criteria
- [x] Steps 1–5 done, evidence above (log excerpts and screenshots were read in the session, not saved to the repository)
- [x] Acceptance boxes in both specs ticked with evidence (the `fern check` part of one box stays noted as not run)
- [x] PLAN.md marks sprints 099–101 done with the live-check line

## Follow-ups / TODO(verify)
- Not run: a real 0.0.120 browser tab (`pi-studio ui` of 0.0.120); `fern check` (CLI not installed); LAN/WAN relay throughput; S9 owner confirmation.
- Observation, not changed: during an outage the connection bar shows the refusal in the pill and tooltip only because the client now reaches `closed`; the workbench itself was not modified.
- Merge to `main` is the release (D21) and was not done.
