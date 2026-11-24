# Task 005 — Live check: a real global npm install updates itself, and rolls back

- **Sprint:** sprints/sprint-136-daemon-update-service
- **Status:** done
- **Type:** test
- **Area:** packages/server, packages/cli, scripts
- **Priority:** P1
- **Estimated size:** M
- **Depends on:** task-004, sprint-135/task-004

## Goal
In a container, a daemon installed with `npm i -g` from a local registry updates itself from N to N+1 through the RPC, and a broken N+2 is rolled back; results recorded.

## Context / why
Spec § Acceptance criteria. Nothing here publishes to the real registry.

## Scope references
- `swe/features/self-update.md` § Acceptance criteria, § TODO(verify)
- new `scripts/daemon-update-check/` (a script and its README): a local npm registry in Docker (verdaccio), `npm pack`/publish of the workspace at three versions (N, N+1, and N+2 whose daemon entry exits at start), a Node container with a global install of N
- `docs/` or `packages/server/docs/`: the recipe and the dated results

## What to build
- Script: start the registry, publish the three versions to it only (`--registry`, never the default), install N globally in a container as a non-root user with a user-owned npm prefix, start the daemon, connect with the SDK.
- Scenarios: offer appears; apply → reconnect on N+1 on the same address; a mock agent and a terminal were open → no old `pi`/child process left, PID file names the new daemon; publish N+2 → apply → rolled back to N+1 with `lastResult.outcome = rolled_back`; a read-only npm folder → `cannot_update(not_writable)`; a folder made read-only after the check → `failed(permission)` and the old daemon still answers; `PI_STUDIO_UPDATE_AUTOCHECK=false`; a relay client (the repo's relay in a container) reconnects after the update.
- Answer the TODO(verify) items: rollback with the registry stopped; the entry path under npm's layout.

## Out of scope
The UI (sprint-137). The desktop (sprint-138).

## Acceptance criteria
- [ ] Each scenario passes, with the evidence (versions, PIDs, process lists, the result file) in the results document.
- [ ] Bugs found are fixed in the owning files with a regression test, and listed.

## Test / verification plan
- The script exits 0; `npm test` still passes.

## Notes
Run everything in containers with their own names and ports; remove them at the end. Root in a container may make every folder writable: run as a normal user.
