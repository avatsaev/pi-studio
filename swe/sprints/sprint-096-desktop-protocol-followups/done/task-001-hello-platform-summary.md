# Task 001 — hello.platform: say which kind of client this is — Summary

- **Sprint:** sprints/sprint-096-desktop-protocol-followups
- **Completed:** 2026-11-14
- **Status:** done

## What was implemented
Added optional `hello.platform` (max 32, bad value dropped via .catch(undefined)) to the protocol, `Session.platform`, `daemon_status` client entries (omitted when absent), `DaemonClientOptions.platform` and the workbench host's `app.platform` passed to the SDK. Rewrote the clientType comment (closed enum, why). New fixture `hello.platform.json`; signatures regenerated; CHANGELOG additive entry.

## Files created / changed
| File | Change |
|------|--------|
| `packages/protocol/src/messages.ts` | helloSchema.platform, PLATFORM_MAX_LENGTH, daemonClientInfoSchema.platform |
| `packages/server/src/ws/{session,ws-server}.ts, daemon/bootstrap.ts (relay), observability/daemon-status-service.ts` | carry platform |
| `packages/client/src/daemon-client.ts` | platform option |
| `packages/workbench/src/{host/types.ts,lib/connection/connection-store.ts}` | app.platform -> hello |
| `packages/protocol/fixtures/external-clients/` | hello.platform.json, manifest, signatures, CHANGELOG |

## How it satisfies the scope
Out of scope kept: clientType unchanged; nothing branches on platform. One addition beyond the task text: the workbench host's `app.platform` so the desktop app can actually send it.

## Build & test results
```
vitest for protocol, server, client (117 files / 1736 tests) pass; external-fixtures Layer A + Layer B e2e (143 tests) pass with the new hello variant (live daemon answers the paired server_info). Old-daemon check: `@av-pi-studio/server@0.0.117` installed in a scratch dir, daemon started on 127.0.0.1:6795, a hello with platform:"desktop" + clientType:"browser" got a server_info reply (0.0.117). Process stopped, scratch removed.
```

## Acceptance criteria
['hello with platform+browser accepted and status shows it: met (unit test on DaemonStatusService; live status e2e fixtures unchanged).', 'Accepted by 0.0.117: met (live check).', 'Fixture tests pass, formatVersion unchanged: met.', 'AGENTS docs: met.', 'Handoff doc: updated.']

## Follow-ups / TODO(verify)
- daemon_status fixtures were NOT given a `platform` field: the live e2e client sends none and a fixture key missing in live output fails. The field is documented as optional; covered by a unit test.
Docs in this task: protocol/client/server/workbench AGENTS + workbench README, root AGENTS protocol overview, desktop-client-handoff.md (status rows, client-type paragraph, transfer facts), the follow-ups spec status + TODO(verify) decisions. The handoff doc now states: platform is accepted by 0.0.117 (checked), invalid hello closes 1008 on direct, upload ack and pacing facts.
