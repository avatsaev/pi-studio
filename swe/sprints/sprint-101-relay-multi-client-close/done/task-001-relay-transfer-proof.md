# Task 001 — Relay transfer proof: 600 MiB each way, bounded memory, a second client answering

- **Sprint:** sprint-101-relay-multi-client-close
- **Status:** done
- **Type:** test
- **Area:** packages/relay, packages/server, packages/client (measurement only)
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** sprint-100/task-006

## Goal
Measured evidence for D18: a 600 MiB download and upload through a local relay finish with matching SHA-256; with the receiver paused, relay and daemon memory stay far below the file size; a second client keeps getting answers. Throughput is recorded beside the direct-connection figures.

## Context / why
The suite proves correctness at 64 MiB (sprint-100/task-006). The acceptance criterion is about scale and memory, which a unit test cannot measure honestly. Sprint-097 measured the same thing on a direct connection (600 MiB, paused client +37 MiB RSS), so the relay figures can be compared directly.

## Scope references
- `swe/features/relay-multi-client.md` § Acceptance criteria (600 MiB, memory, second client), D18, § TODO(verify) (Relay throughput)
- Built entrypoints: `packages/relay/dist/relay-main.js`, `packages/server/dist/daemon/main.js`, the SDK `FileTransferClient`
- `swe/sprints/sprint-097-download-ranges/done/task-007-download-docs-and-live-checks-summary.md` (the direct figures and how they were taken)

## What to build
A throwaway harness (scratch directory outside the repository, deleted afterwards) that:
- runs `pi-studio-relay` and a production daemon as separate processes (scratch `PI_STUDIO_HOME`, relay enabled, `PI_STUDIO_LISTEN` on a free port);
- connects one SDK client through the relay's pairing URL, and downloads and uploads a 600 MiB random file, comparing SHA-256;
- repeats the download with the client paused for 30 s mid-transfer (stop reading the socket), sampling RSS of the relay and the daemon every second;
- runs a second relay client that sends `list_agents_request` every 500 ms during the transfer and records the latency;
- records throughput for both directions.

## Out of scope
- A permanent benchmark or a pass mark (D18: recorded, not gated).

## Acceptance criteria
- [ ] Both transfers finish with matching SHA-256.
- [ ] Peak RSS growth of the relay and of the daemon during the paused download is reported and is far below 600 MiB (single-digit to tens of MiB expected from the 1 MiB marks).
- [ ] The second client's answers keep arriving during the transfer; worst latency is recorded.
- [ ] Throughput both ways is recorded next to the sprint-097 direct figures.
- [ ] The figures are in the task summary, with the machine, the commands and the versions. The harness is deleted.

## Test / verification plan
- `npm run build` first.
- Run the harness; paste its output into the summary.

## Notes
- Shared documents: `docs/desktop-client-handoff.md` gets the figures in task-002. Do not edit it here.
- If memory is not bounded, stop and report: it means flow control (sprint-099/task-005) or the daemon's pacing over `RelayConnection.bufferedAmount` does not hold. Block the task rather than relaxing the criterion.
