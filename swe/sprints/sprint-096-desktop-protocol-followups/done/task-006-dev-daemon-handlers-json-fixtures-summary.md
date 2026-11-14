# Task 006 — Dev daemon handlers and JSON fixtures for file transfer and terminals — Summary

- **Sprint:** sprints/sprint-096-desktop-protocol-followups
- **Completed:** 2026-11-14
- **Status:** done

## What was implemented
Dev bootstrap now registers FileTransferService (+FileExplorerService token hook, binary handler, disposeSession) and the terminal handlers (+binary handler, killAll on close), wired as in production. The fixture scenario drives token->download, ack upload->file_upload_complete, and create/subscribe/list/rename/capture/kill terminal + terminals_update inside a temp dir. 20 new JSON fixtures (since 0.0.118; file_upload_request and file_upload_complete gated by fileTransferAck), manifest, signatures, CHANGELOG, README, server/protocol/root AGENTS. Implemented by a subagent (FileTerminalFixtures), reviewed by the orchestrator.

## Files created / changed
| File | Change |
|------|--------|
| `packages/server/src/daemon/dev-bootstrap.ts` | file-transfer + terminal handlers |
| `packages/server/src/test-support/{daemon-test-client,external-fixtures-scenario}.ts` | binary frames collected; new scenario steps |
| `packages/server/src/daemon/external-fixtures-e2e.test.ts` | live temp paths/tokens/slots for the new fixtures |
| `packages/protocol/fixtures/external-clients/` | 20 new fixtures + manifest/signatures/CHANGELOG/README |

## How it satisfies the scope
Binary frames are task-007. formatVersion stays 1. The subagent reported 22 new fixtures; the manifest has 81 entries (60 + hello.platform + 20), so 20.

## Build & test results
```
vitest protocol + server (whole suites) pass incl. Layer A 95 tests and Layer B live e2e; build:server clean; no daemons/PTYs left running.
```

## Acceptance criteria
['Every listed message has a fixture passing both layers: met.', 'formatVersion unchanged: met.', 'Dev daemon answers terminal + file-transfer, documented in root AGENTS and server AGENTS: met.', 'No real path/host/token in fixtures: met (token literal FAKE; Layer A secret scan passes).', 'Handoff doc updated: met (dev daemon line, fixture coverage).']

## Follow-ups / TODO(verify)
- None.
